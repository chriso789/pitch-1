import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';
import { runAction } from '../_shared/actions.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BATCH = 25;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE}`) return json({ error: 'Service authorization required' }, 403);
    const { data: runs, error } = await admin.rpc('claim_automation_runs', { p_limit: BATCH });
    if (error) throw error;
    let ok = 0, fail = 0;
    for (const run of runs ?? []) {
      // Load the rule's actions
      const { data: rule } = await admin
        .from('automation_rules_v2')
        .select('id, actions')
        .eq('id', run.automation_rule_id)
        .eq('company_id', run.company_id)
        .maybeSingle();

      const actions = (rule?.actions ?? []) as any[];
      let runOk = actions.length > 0;
      let firstError: string | null = actions.length ? null : 'Rule is missing or has no actions';

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const started = new Date().toISOString();
        const result = await runAction(admin, action, run);
        const finished = new Date().toISOString();

        const { error: logError } = await admin.from('automation_action_runs').insert({
          automation_run_id: run.id,
          action_index: i,
          action_type: action.type,
          status: result.status, // 'success' | 'skipped' | 'failed'
          result: result.detail ?? {},
          error_text: result.error ?? null,
          started_at: started,
          finished_at: finished,
        });

        if (logError || result.status !== 'success') {
          runOk = false;
          if (!firstError) firstError = logError?.message ?? result.error ?? String(result.detail?.reason ?? 'Action did not complete');
          // Continue with remaining actions; one bad action shouldn't block the rest.
        }
      }

      await admin.from('automation_runs').update({
        status: runOk ? 'success' : 'failed',
        finished_at: new Date().toISOString(),
        skip_reason: firstError,
      }).eq('id', run.id);

      runOk ? ok++ : fail++;
    }

    return json({ processed: runs?.length ?? 0, ok, fail }, 200);
  } catch (e) {
    console.error('[automation-worker] error', e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
