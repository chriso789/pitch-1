// ai-context-builder
// Drains ai_context_refresh_queue and rebuilds ai_context_profiles snapshots.
// Phase 2 implementation: structured facts only (cheap, deterministic).
// LLM-generated summary_short / summary_long is a TODO for Phase 3.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BATCH = 20;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { data: items, error } = await admin
      .from('ai_context_refresh_queue')
      .select('*')
      .eq('status', 'queued')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(BATCH);
    if (error) throw error;

    let ok = 0, fail = 0;
    for (const item of items ?? []) {
      await admin.from('ai_context_refresh_queue')
        .update({ status: 'running', attempts: (item.attempts ?? 0) + 1 })
        .eq('id', item.id);

      try {
        await rebuildSnapshot(item.company_id, item.scope_type, item.scope_id);
        await admin.from('ai_context_refresh_queue')
          .update({ status: 'done' })
          .eq('id', item.id);
        ok++;
      } catch (e) {
        await admin.from('ai_context_refresh_queue')
          .update({ status: 'failed', last_error: String(e) })
          .eq('id', item.id);
        fail++;
      }
    }

    return json({ processed: items?.length ?? 0, ok, fail }, 200);
  } catch (e) {
    console.error('[ai-context-builder] error', e);
    return json({ error: String(e) }, 500);
  }
});

async function rebuildSnapshot(company_id: string, scope_type: string, scope_id: string) {
  // Pull recent comms + last domain events for this scope; compose a structured snapshot.
  const sinceISO = new Date(Date.now() - 90 * 86400000).toISOString();

  const { data: events } = await admin
    .from('domain_events')
    .select('event_type, occurred_at, payload')
    .eq('company_id', company_id)
    .eq('entity_type', scope_type)
    .eq('entity_id', scope_id)
    .gte('occurred_at', sinceISO)
    .order('occurred_at', { ascending: false })
    .limit(50);

  const { data: comms } = await admin
    .from('communication_history')
    .select('communication_type, direction, content, created_at')
    .eq('tenant_id', company_id)
    .or(scope_type === 'contact'
      ? `contact_id.eq.${scope_id}`
      : scope_type === 'pipeline_entry'
        ? `pipeline_entry_id.eq.${scope_id}`
        : `project_id.eq.${scope_id}`)
    .gte('created_at', sinceISO)
    .order('created_at', { ascending: false })
    .limit(25);

  const lastEventAt = events?.[0]?.occurred_at ?? null;
  const inboundCount = (comms ?? []).filter((c) => c.direction === 'inbound').length;
  const outboundCount = (comms ?? []).filter((c) => c.direction === 'outbound').length;

  const profile = {
    company_id,
    scope_type,
    scope_id,
    structured_facts: {
      events_last_90d: events?.length ?? 0,
      comms_last_90d: comms?.length ?? 0,
      inbound: inboundCount,
      outbound: outboundCount,
    },
    recent_activity: (events ?? []).slice(0, 10),
    communication_snapshot: { recent: (comms ?? []).slice(0, 10) },
    open_loops: [],
    refreshed_at: new Date().toISOString(),
    last_event_at: lastEventAt,
  };

  // Upsert
  const { error } = await admin
    .from('ai_context_profiles')
    .upsert(profile, { onConflict: 'company_id,scope_type,scope_id' });
  if (error) throw error;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
