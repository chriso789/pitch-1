// Shared action executors for automation-worker.
// Returns: { status: 'success'|'skipped'|'failed', detail?, error? }
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.1';

type ActionResult = {
  status: 'success' | 'skipped' | 'failed';
  detail?: Record<string, unknown>;
  error?: string;
};

export async function runAction(
  admin: SupabaseClient,
  action: { type: string; params?: Record<string, any> },
  run: any
): Promise<ActionResult> {
  const params = action.params ?? {};
  try {
    switch (action.type) {
      case 'send_email_template': return await sendTemplate(admin, params, run, 'email');
      case 'send_sms_template': return await sendTemplate(admin, params, run, 'sms');
      case 'create_followup_reminder': {
        const due_at = dueAt(params);
        if (!due_at) throw new Error('Set a reminder date or delay');
        return await createTask(admin, { ...params, due_at }, run);
      }
      case 'request_document': return await requestDocument(admin, params, run);
      case 'escalate_to_manager': return await escalate(admin, params, run);
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
  let assignedTo = p.assigned_to ?? null;
  if (!assignedTo && p.assignee_role) {
    const { data, error } = await admin.from('user_roles').select('user_id').eq('tenant_id', run.company_id)
      .eq('role', p.assignee_role).order('user_id').limit(1).maybeSingle();
    if (error || !data) throw error || new Error('No user has the requested company role');
    assignedTo = data.user_id;
  }
  if (!assignedTo && p.assignee_field) {
    const field = String(p.assignee_field).split('.').pop();
    if (!['assigned_to', 'created_by', 'project_manager_id'].includes(field)) throw new Error('Unsupported assignee field');
    const table = entityTable(run.entity_type);
    if (!table) throw new Error('Cannot resolve task assignee');
    const { data, error } = await admin.from(table).select(field).eq('id', run.entity_id).eq('tenant_id', run.company_id).single();
    if (error || !data?.[field]) throw error || new Error('The related record has no assignee');
    assignedTo = data[field];
  }
  if (assignedTo) {
    const { data, error } = await admin.from('user_roles').select('user_id').eq('tenant_id', run.company_id).eq('user_id', assignedTo).limit(1).maybeSingle();
    if (error || !data) throw error || new Error('Task assignee is not in this company');
  }
  const insert = {
    tenant_id: run.company_id,
    task_name: p.title ?? 'Automation task',
    description: p.description ?? null,
    assigned_to: assignedTo,
    due_date: p.due_at ?? dueAt(p),
    ai_context: { entity_type: run.entity_type, entity_id: run.entity_id, automation_run_id: run.id },
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
  const col = p.field ?? p.assignee_field?.split('.').pop() ?? 'assigned_to';
  const { error } = await admin.from(table).update({ [col]: userId }).eq('id', run.entity_id).eq('tenant_id', run.company_id);
  if (error) return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  return { status: 'success', detail: { table, field: col, user_id: userId } };
}

async function changeStatus(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  const table = entityTable(run.entity_type);
  if (!table) return { status: 'skipped', detail: { reason: 'no_table' } };
  const col = p.field ?? 'status';
  p.value = p.value ?? p.status;
  if (!p.value) return { status: 'failed', error: 'value required' };
  const { error } = await admin.from(table).update({ [col]: p.value }).eq('id', run.entity_id).eq('tenant_id', run.company_id);
  if (error) return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  return { status: 'success', detail: { table, field: col, value: p.value } };
}

async function updateField(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  const table = entityTable(run.entity_type);
  if (!table) return { status: 'skipped', detail: { reason: 'no_table' } };
  if (!p.field) return { status: 'failed', error: 'field required' };
  const { error } = await admin.from(table).update({ [p.field]: p.value ?? null }).eq('id', run.entity_id).eq('tenant_id', run.company_id);
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
  const { error } = await admin.from('automation_generated_records').insert({
    company_id: run.company_id,
    automation_run_id: run.id,
    record_table: table,
    record_id: id,
  });
  if (error) console.warn('automation_generated_records insert failed:', error.message);
}

function dueAt(p: Record<string, any>): string | null {
  if (p.due_at) { const date = new Date(p.due_at); if (!Number.isFinite(date.getTime())) throw new Error('Invalid due date'); return date.toISOString(); }
  const minutes = p.due_in_minutes ?? (p.due_in_hours == null ? null : Number(p.due_in_hours) * 60);
  if (minutes == null) return null;
  if (!Number.isFinite(Number(minutes)) || Number(minutes) < 0) throw new Error('Invalid reminder delay');
  return new Date(Date.now() + Number(minutes) * 60000).toISOString();
}

async function actionContact(admin: SupabaseClient, run: any) {
  let contactId = run.entity_type === 'contact' ? run.entity_id : null;
  if (!contactId) {
    const table = entityTable(run.entity_type);
    if (!table) throw new Error('Action requires a linked customer');
    const directContact = run.entity_type === 'job' || run.entity_type === 'pipeline_entry';
    const { data, error } = await admin.from(table).select(directContact ? 'contact_id' : 'pipeline_entry_id')
      .eq('id', run.entity_id).eq('tenant_id', run.company_id).single();
    if (error) throw error;
    if (directContact) contactId = data?.contact_id;
    else if (data?.pipeline_entry_id) {
      const { data: lead, error: leadError } = await admin.from('pipeline_entries').select('contact_id')
        .eq('id', data.pipeline_entry_id).eq('tenant_id', run.company_id).single();
      if (leadError) throw leadError;
      contactId = lead?.contact_id;
    }
    if (!contactId) throw new Error('The automation record has no linked customer');
  }
  const { data, error } = await admin.from('contacts').select('id, email, phone, first_name, last_name').eq('id', contactId).eq('tenant_id', run.company_id).single();
  if (error || !data) throw error || new Error('Customer not found');
  return data;
}

async function deliver(run: any, contact: any, channel: 'email' | 'sms', content: string, subject?: string): Promise<ActionResult> {
  const to = channel === 'email' ? contact.email : contact.phone;
  if (!to) throw new Error(`Customer has no ${channel === 'email' ? 'email' : 'phone'}`);
  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${channel === 'email' ? 'email-send' : 'telnyx-send-sms'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify(channel === 'email' ? { to, subject, html: content, tenant_id: run.company_id, contact_id: contact.id, metadata: { automation_run_id: run.id } }
      : { to, message: content, tenant_id: run.company_id, contactId: contact.id }),
  });
  const data = await response.json();
  if (!response.ok || data.success !== true) throw new Error(data.error || 'Delivery failed');
  return { status: 'success', detail: { contact_id: contact.id, message_id: data.message_id || data.messageId } };
}

async function sendTemplate(admin: SupabaseClient, p: any, run: any, channel: 'email' | 'sms'): Promise<ActionResult> {
  if (!p.template_slug) throw new Error('Choose a template name');
  const contact = await actionContact(admin, run);
  // Existing company template names are the UI's template identifier.
  const { data: template, error } = await admin.from('message_templates').select('content, subject').eq('tenant_id', run.company_id)
    .eq('name', p.template_slug).eq('template_type', channel).single();
  if (error || !template) throw error || new Error('Company template not found');
  const render = (text: string) => text.replace(/\{\{?\s*contact\.(first_name|last_name|email|phone)\s*\}?\}/g, (_: string, key: string) => String(contact[key] || ''));
  const body = render(template.content); const subject = render(template.subject || 'Project update');
  if (/\{\{?[^{}]+\}?\}/.test(body + subject)) throw new Error('Template has unresolved smart tags');
  if (p.to_field && p.to_field !== `contact.${channel === 'email' ? 'email' : 'phone'}`) throw new Error('Recipient must be the linked customer');
  return deliver(run, contact, channel, body, subject);
}

async function requestDocument(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  if (!p.document_type) throw new Error('Document type is required');
  const contact = await actionContact(admin, run);
  const text = String(p.message || `Please provide your ${p.document_type}. Reply to this email with your document.`);
  return deliver(run, contact, 'email', text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)), `Document requested: ${p.document_type}`);
}

async function escalate(admin: SupabaseClient, p: any, run: any): Promise<ActionResult> {
  const { data: managers, error } = await admin.from('user_roles').select('user_id').eq('tenant_id', run.company_id).in('role', ['owner', 'office_admin', 'regional_manager', 'sales_manager', 'project_manager']);
  if (error) throw error;
  if (!managers?.length) throw new Error('No company manager is configured');
  for (const manager of [...new Map(managers.map(manager => [manager.user_id, manager])).values()]) {
    const result = await createTask(admin, { title: 'Manager escalation', description: p.reason || 'Review required', assigned_to: manager.user_id, priority: 'high' }, run);
    if (result.status !== 'success') return result;
  }
  return { status: 'success', detail: { managers_notified: managers.length } };
}
