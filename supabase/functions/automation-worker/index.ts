// automation-worker
// Drains queued automation_runs, executes each rule's actions, writes per-action
// rows to automation_action_runs, and updates the parent run's status.
//
// Phase 2 "safe set" of executors:
//   create_task, create_internal_note, assign_user, change_status,
//   update_field, rebuild_smart_tags, rebuild_ai_memory, notify_channel,
//   webhook_post.
// send_email_template, send_sms_template, request_document, escalate_to_manager,
// create_followup_reminder are stubbed -> action row 'skipped:not_implemented'.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
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
    // Claim a batch of queued runs
    const { data: runs, error } = await admin
      .from('automation_runs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(BATCH);
    if (error) throw error;

    let ok = 0, fail = 0;
    for (const run of runs ?? []) {
      // Mark running (optimistic; no row-level lock here, dedupe is via unique key on enqueue)
      await admin.from('automation_runs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', run.id)
        .eq('status', 'queued');

      // Re-read to ensure we still own it
      const { data: claimed } = await admin
        .from('automation_runs').select('status').eq('id', run.id).maybeSingle();
      if (!claimed || claimed.status !== 'running') continue;

      // Load the rule's actions
      const { data: rule } = await admin
        .from('automation_rules_v2')
        .select('id, actions')
        .eq('id', run.automation_rule_id)
        .maybeSingle();

      const actions = (rule?.actions ?? []) as any[];
      let runOk = true;
      let firstError: string | null = null;

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const started = new Date().toISOString();
        const result = await runAction(admin, action, run);
        const finished = new Date().toISOString();

        await admin.from('automation_action_runs').insert({
          company_id: run.company_id,
          automation_run_id: run.id,
          action_index: i,
          action_type: action.type,
          status: result.status, // 'success' | 'skipped' | 'failed'
          result: result.detail ?? {},
          error_message: result.error ?? null,
          started_at: started,
          finished_at: finished,
        });

        if (result.status === 'failed') {
          runOk = false;
          if (!firstError) firstError = result.error ?? 'action failed';
          // Continue with remaining actions; one bad action shouldn't block the rest.
        }
      }

      await admin.from('automation_runs').update({
        status: runOk ? 'success' : 'failed',
        finished_at: new Date().toISOString(),
        error_message: firstError,
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
