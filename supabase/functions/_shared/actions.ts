// Shared action executors for automation-worker.
// Returns: { status: 'success'|'skipped'|'failed', detail?, error? }
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

type ActionResult = {
  status: 'success' | 'skipped' | 'failed';
  detail?: Record<string, unknown>;
  error?: string;
};

const STUBBED = new Set([
  'send_email_template',
  'send_sms_template',
  'request_document',
  'escalate_to_manager',
  'create_followup_reminder',
]);

export async function runAction(
  admin: SupabaseClient,
  action: { type: string; params?: Record<string, any> },
  run: any
): Promise<ActionResult> {
  const params = action.params ?? {};
  try {
    if (STUBBED.has(action.type)) {
      return { status: 'skipped', detail: { reason: 'not_implemented_phase2' } };
    }

    switch (action.type) {
      case 'create_task': return await createTask(admin, params, run);
      case 'create_internal_note': return await createInternalNote(admin, params, run);
      case 'assign_user': return await assignUser(admin, params, run);
      case 'change_status': return await changeStatus(admin, params, run);
      case 'update_field': return await updateField(admin, params, run);
      case 'rebuild_smart_tags': return await queueSmartTagRebuild(admin, params, run);
      case 'rebuild_ai_memory': return await queueAiRebuild(admin, params, run);
      case 'notify_channel': return await notifyChannel(admin, params, run);
      case 'webhook_post': return await webhookPost(params, run);
      default:
        return { status: 'skipped', detail: { reason: 'unknown_action_type', type: action.type } };
    }
  } catch (e) {
    return { status: 'failed', error: String(e) };
  }
}

// --- Executors ---------------------------------------------------------------

async function createTask(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  const insert = {
    tenant_id: run.company_id,
    title: p.title ?? 'Automation task',
    description: p.description ?? null,
    assigned_to: p.assigned_to ?? null,
    due_date: p.due_at ?? null,
    related_entity_type: run.entity_type,
    related_entity_id: run.entity_id,
    priority: p.priority ?? 'medium',
    status: 'pending',
  };
  const { data, error } = await admin.from('workflow_tasks').insert(insert).select('id').maybeSingle();
  if (error) return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  await trackGenerated(admin, run, 'workflow_tasks', data?.id);
  return { status: 'success', detail: { task_id: data?.id } };
}

async function createInternalNote(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  // Best-effort: write into communication_history as an internal note.
  const insert = {
    tenant_id: run.company_id,
    contact_id: p.contact_id ?? (run.entity_type === 'contact' ? run.entity_id : null),
    pipeline_entry_id: run.entity_type === 'pipeline_entry' ? run.entity_id : null,
    project_id: run.entity_type === 'project' ? run.entity_id : null,
    communication_type: 'note',
    direction: 'internal',
    content: p.body ?? '(automation note)',
    metadata: { source: 'automation', run_id: run.id },
  };
  const { data, error } = await admin.from('communication_history').insert(insert).select('id').maybeSingle();
  if (error) return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  await trackGenerated(admin, run, 'communication_history', data?.id);
  return { status: 'success', detail: { note_id: data?.id } };
}

async function assignUser(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  const userId = p.user_id;
  if (!userId) return { status: 'failed', error: 'user_id required' };
  const table = entityTable(run.entity_type);
  if (!table) return { status: 'skipped', detail: { reason: 'entity_not_assignable' } };
  const col = p.field ?? 'assigned_to';
  const { error } = await admin.from(table).update({ [col]: userId }).eq('id', run.entity_id);
  if (error) return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  return { status: 'success', detail: { table, field: col, user_id: userId } };
}

async function changeStatus(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  const table = entityTable(run.entity_type);
  if (!table) return { status: 'skipped', detail: { reason: 'no_table' } };
  const col = p.field ?? 'status';
  if (!p.value) return { status: 'failed', error: 'value required' };
  const { error } = await admin.from(table).update({ [col]: p.value }).eq('id', run.entity_id);
  if (error) return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  return { status: 'success', detail: { table, field: col, value: p.value } };
}

async function updateField(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  const table = entityTable(run.entity_type);
  if (!table) return { status: 'skipped', detail: { reason: 'no_table' } };
  if (!p.field) return { status: 'failed', error: 'field required' };
  const { error } = await admin.from(table).update({ [p.field]: p.value ?? null }).eq('id', run.entity_id);
  if (error) return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  return { status: 'success', detail: { table, field: p.field } };
}

async function queueSmartTagRebuild(admin: SupabaseClient, _p: any, run: any): Promise<ActionResult> {
  // Mark cache stale by deleting; resolver will rebuild lazily.
  const { error } = await admin.from('smart_tag_cache')
    .delete()
    .eq('company_id', run.company_id)
    .eq('entity_type', run.entity_type)
    .eq('entity_id', run.entity_id);
  if (error) return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  return { status: 'success', detail: { invalidated: true } };
}

async function queueAiRebuild(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  const scope_type = p.scope_type ?? run.entity_type;
  const scope_id = p.scope_id ?? run.entity_id;
  const { error } = await admin.from('ai_context_refresh_queue').insert({
    company_id: run.company_id,
    scope_type,
    scope_id,
    reason: `automation:${run.automation_rule_id}`,
    priority: p.priority ?? 5,
    status: 'queued',
  });
  if (error) return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  return { status: 'success', detail: { scope_type, scope_id } };
}

async function notifyChannel(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  // Lightweight: write to ai_insights as an internal feed item.
  const { data, error } = await admin.from('ai_insights').insert({
    tenant_id: run.company_id,
    context_type: run.entity_type,
    context_id: run.entity_id,
    insight_type: 'automation_notification',
    title: p.title ?? 'Automation notification',
    description: p.message ?? '',
    priority: p.priority ?? 'medium',
    status: 'open',
    metadata: { run_id: run.id, channel: p.channel ?? 'default' },
  }).select('id').maybeSingle();
  if (error) return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  return { status: 'success', detail: { insight_id: data?.id } };
}

async function webhookPost(p: any, run: any): Promise<ActionResult> {
  if (!p.url) return { status: 'failed', error: 'url required' };
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(p.headers ?? {}) },
    body: JSON.stringify({
      run_id: run.id,
      company_id: run.company_id,
      entity_type: run.entity_type,
      entity_id: run.entity_id,
      payload: p.payload ?? run.trigger_payload ?? {},
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { status: 'failed', error: `webhook ${res.status}: ${text.slice(0, 200)}` };
  }
  return { status: 'success', detail: { status: res.status } };
}

// --- helpers -----------------------------------------------------------------

function entityTable(entity_type: string): string | null {
  switch (entity_type) {
    case 'job': return 'jobs';
    case 'pipeline_entry': return 'pipeline_entries';
    case 'estimate': return 'estimates';
    case 'project': return 'projects';
    case 'contact': return 'contacts';
    case 'invoice': return 'project_invoices';
    case 'payment': return 'project_payments';
    default: return null;
  }
}

async function trackGenerated(admin: SupabaseClient, run: any, table: string, id?: string | null) {
  if (!id) return;
  await admin.from('automation_generated_records').insert({
    company_id: run.company_id,
    automation_run_id: run.id,
    record_table: table,
    record_id: id,
  }).then(() => {}).catch(() => {});
}
