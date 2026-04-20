// automation-dispatcher
// Pulls unprocessed domain_events, matches them against active automation_rules_v2,
// and enqueues automation_runs. Cheap matching only — no action execution here.
//
// Invocation modes:
//   - {} or {batch: true} : drain up to BATCH events (cron mode)
//   - {event_id: uuid}    : process exactly one event (realtime kick)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';
import { evaluateConditions } from '../_shared/conditions.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BATCH = 100;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* cron pings have no body */ }

  try {
    const events = body.event_id
      ? await fetchOne(body.event_id)
      : await fetchBatch();

    let queued = 0;
    let skipped = 0;
    for (const ev of events) {
      const result = await dispatchEvent(ev);
      queued += result.queued;
      skipped += result.skipped;
    }

    return json({ processed: events.length, queued, skipped }, 200);
  } catch (e) {
    console.error('[automation-dispatcher] error', e);
    return json({ error: String(e) }, 500);
  }
});

async function fetchOne(id: string) {
  const { data, error } = await admin
    .from('domain_events')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? [data] : [];
}

async function fetchBatch() {
  // Pull events from the last 24h that have no automation_runs yet.
  // Cheap version: pull recent events, dedupe in-memory by checking runs.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('domain_events')
    .select('*')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(BATCH);
  if (error) throw error;
  return data ?? [];
}

async function dispatchEvent(ev: any): Promise<{ queued: number; skipped: number }> {
  // Find active rules for this company + event_type
  const { data: rules, error: rulesErr } = await admin
    .from('automation_rules_v2')
    .select('*')
    .eq('company_id', ev.company_id)
    .eq('trigger_event', ev.event_type)
    .eq('is_active', true);

  if (rulesErr) {
    console.error('[dispatcher] rules fetch failed', rulesErr);
    return { queued: 0, skipped: 0 };
  }
  if (!rules || rules.length === 0) return { queued: 0, skipped: 0 };

  let queued = 0;
  let skipped = 0;

  for (const rule of rules) {
    // Conditions check (cheap, in-memory)
    const conds = (rule.conditions ?? []) as any[];
    const ok = evaluateConditions(conds, ev.payload ?? {});
    if (!ok) { skipped++; continue; }

    // Cooldown check: last successful run for (rule, entity)
    if (rule.cooldown_seconds && rule.cooldown_seconds > 0) {
      const cutoff = new Date(Date.now() - rule.cooldown_seconds * 1000).toISOString();
      const { data: recent } = await admin
        .from('automation_runs')
        .select('id')
        .eq('automation_rule_id', rule.id)
        .eq('entity_id', ev.entity_id)
        .in('status', ['success', 'queued', 'running'])
        .gte('created_at', cutoff)
        .limit(1);
      if (recent && recent.length > 0) { skipped++; continue; }
    }

    // Daily cap per entity
    if (rule.max_runs_per_entity_per_day && rule.max_runs_per_entity_per_day > 0) {
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const { count } = await admin
        .from('automation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('automation_rule_id', rule.id)
        .eq('entity_id', ev.entity_id)
        .gte('created_at', dayStart.toISOString());
      if ((count ?? 0) >= rule.max_runs_per_entity_per_day) { skipped++; continue; }
    }

    // Enqueue (unique on (rule, event) protects against double-fire)
    const { error: insErr } = await admin.from('automation_runs').insert({
      company_id: ev.company_id,
      automation_rule_id: rule.id,
      domain_event_id: ev.id,
      entity_type: ev.entity_type,
      entity_id: ev.entity_id,
      status: 'queued',
      trigger_payload: ev.payload ?? {},
    });

    if (insErr) {
      // 23505 = already queued for this (rule, event); fine.
      if (insErr.code === '23505') { skipped++; continue; }
      console.error('[dispatcher] enqueue failed', insErr);
      skipped++;
      continue;
    }
    queued++;

    if (rule.stop_processing_on_match) break;
  }

  // Best-effort kick worker
  if (queued > 0) {
    queueMicrotask(() => {
      admin.functions.invoke('automation-worker', { body: {} })
        .catch((e) => console.warn('[dispatcher] worker kick failed', e));
    });
  }

  return { queued, skipped };
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
