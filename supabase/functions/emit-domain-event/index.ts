// emit-domain-event
// Public-ish helper for app code (and DB triggers via pg_net) to insert a row
// into public.domain_events with dedupe + automatic dispatcher kick.
//
// POST body: {
//   company_id: uuid,
//   event_type: string,         // e.g. "job.status_changed"
//   entity_type: string,        // e.g. "job"
//   entity_id: uuid,
//   parent_entity_type?: string,
//   parent_entity_id?: uuid,
//   payload?: object,
//   dedupe_key?: string,
//   occurred_at?: ISO string,
//   actor_user_id?: uuid,
//   source?: string             // "app" | "trigger" | "worker"
// }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();

    const required = ['company_id', 'event_type', 'entity_type', 'entity_id'];
    for (const k of required) {
      if (!body[k]) {
        return json({ error: `missing ${k}` }, 400);
      }
    }

    // Verify event_type is registered (cheap guard against typos)
    const { data: et } = await admin
      .from('event_types')
      .select('key')
      .eq('key', body.event_type)
      .maybeSingle();
    if (!et) return json({ error: `unknown event_type: ${body.event_type}` }, 400);

    const insert = {
      company_id: body.company_id,
      event_type: body.event_type,
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      parent_entity_type: body.parent_entity_type ?? null,
      parent_entity_id: body.parent_entity_id ?? null,
      payload: body.payload ?? {},
      dedupe_key: body.dedupe_key ?? null,
      occurred_at: body.occurred_at ?? new Date().toISOString(),
      actor_user_id: body.actor_user_id ?? null,
      source: body.source ?? 'app',
    };

    const { data, error } = await admin
      .from('domain_events')
      .insert(insert)
      .select('id')
      .maybeSingle();

    // Dedupe collision -> treat as success (idempotent)
    if (error && (error.code === '23505' || /duplicate/i.test(error.message))) {
      return json({ deduped: true }, 200);
    }
    if (error) {
      console.error('[emit-domain-event] insert failed', error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }

    // Fire-and-forget dispatcher kick (best-effort, don't block caller)
    queueMicrotask(() => {
      admin.functions.invoke('automation-dispatcher', { body: { event_id: data?.id } })
        .catch((e) => console.warn('[emit-domain-event] dispatcher kick failed', e));
    });

    return json({ id: data?.id }, 200);
  } catch (e) {
    console.error('[emit-domain-event] error', e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
