import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { unzipSync } from 'npm:fflate@0.8.3';
import { fillPermitPdf, generateChecklistPdf, generatePermitPacket } from './pdf_fill.ts';
import { runAction } from './actions.ts';
import { handle } from '../supplier-api/billtrust-pricing-handler.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
async function rejects(fn: () => Promise<unknown>, text: string) { try { await fn(); } catch (e) { assert(String(e).includes(text), String(e)); return; } throw new Error('Expected rejection'); }

Deno.test('Billtrust sync refuses without touching a price cache', async () => {
  const response = await handle(new Request('https://example.test', { method: 'POST', body: '{}' }));
  assert(response.status === 503); assert((await response.json()).success === false);
});
Deno.test('Permit application fills mapped fields and survives PDF read-back', async () => {
  const pdf = await PDFDocument.create(); const page = pdf.addPage();
  const name = pdf.getForm().createTextField('Applicant'); name.addToPage(page); name.setText('old');
  const data = await pdf.save();
  const sb = { storage: { from: () => ({ download: () => ({ data: new Blob([data]), error: null }) }) } };
  const bytes = await fillPermitPdf({ supabase: sb, template_pdf_bucket: 'permits', template_pdf_path: 'form.pdf',
    field_values: { contractor_name: 'Test Roofing', irrelevant_optional: null }, field_map: [{ pdf_field: 'Applicant', value_key: 'contractor_name' }] });
  const reopened = await PDFDocument.load(bytes);
  assert(reopened.getForm().getTextField('Applicant').getText() === 'Test Roofing');
});
Deno.test('Missing authority template cannot produce a fake PDF', async () => {
  await rejects(() => fillPermitPdf({ supabase: {}, template_pdf_bucket: null, template_pdf_path: null, field_values: {}, field_map: [] }), 'Configure an authority PDF');
});
Deno.test('Mapped nonexistent fields block application export', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage(); const data = await pdf.save();
  const sb = { storage: { from: () => ({ download: () => ({ data: new Blob([data]), error: null }) }) } };
  await rejects(() => fillPermitPdf({ supabase: sb, template_pdf_bucket: 'permits', template_pdf_path: 'form.pdf', field_values: { name: 'Test' }, field_map: [{ pdf_field: 'Missing', value_key: 'name' }] }), 'Missing');
});
Deno.test('Checklist with many attachments is a valid multipage PDF', async () => {
  const bytes = await generateChecklistPdf({ permit_case_id: 'test', authority_name: 'Test County', required_attachments: Array.from({ length: 100 }, (_, i) => `Attachment ${i}`), available_attachments: ['Attachment 1'] });
  const pdf = await PDFDocument.load(bytes); assert(pdf.getPageCount() > 1);
});
Deno.test('Packet contains real attachment bytes and refuses missing required documents', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
  const docs = [{ id: 'one', kind: 'PERMIT_APPLICATION', title: 'Application', storage_bucket: 'permits', storage_path: 'app.pdf' }];
  const filters: Record<string, string> = {};
  const query: any = { select: () => query, eq: (key: string, value: string) => { filters[key] = value; return query; }, neq: () => query, order: () => ({ data: docs, error: null }) };
  const sb = { from: () => query, storage: { from: () => ({ download: () => ({ data: new Blob([bytes]), error: null }) }) } };
  const packet = await generatePermitPacket(sb, 'tenant-a', 'case-a', ['PERMIT_APPLICATION']);
  const files = unzipSync(packet); assert(files['one-Application.pdf'].length === bytes.length); assert(files['manifest.json']);
  assert(filters.tenant_id === 'tenant-a' && filters.permit_case_id === 'case-a');
  await rejects(() => generatePermitPacket(sb, 'tenant-a', 'case-a', ['Insurance']), 'Insurance');
});
Deno.test('Followup reminder creates a real dated task against its company', async () => {
  let task: any;
  const query: any = { insert: (row: any) => { task = row; return query; }, select: () => query, maybeSingle: () => ({ data: { id: 'task-a' }, error: null }) };
  const admin: any = { from: (table: string) => table === 'workflow_tasks' ? query : { insert: () => ({ error: null }) } };
  const result = await runAction(admin, { type: 'create_followup_reminder', params: { title: 'Call homeowner', due_in_minutes: 30 } }, { company_id: 'tenant-a', id: 'run-a', entity_type: 'contact', entity_id: 'contact-a' });
  assert(result.status === 'success');
  assert(task.tenant_id === 'tenant-a' && task.task_name === 'Call homeowner');
  assert(new Date(task.due_date).getTime() > Date.now() + 29 * 60000);
});
Deno.test('Invalid reminder delay and missing templates fail instead of silently skipping', async () => {
  const run = { id: 'run-a', company_id: 'tenant-a', entity_type: 'contact', entity_id: 'contact-a' };
  assert((await runAction({} as any, { type: 'create_followup_reminder', params: { due_in_minutes: -1 } }, run)).status === 'failed');
  assert((await runAction({} as any, { type: 'send_email_template', params: {} }, run)).status === 'failed');
});

Deno.test('template email uses the run company and cannot report a rejected provider call as success', async () => {
  const filters: Array<[string, unknown]> = [];
  const admin: any = { from: (table: string) => {
    const query: any = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key,value]); return query; },
      single: () => ({ data: table === 'contacts' ? { id:'contact-a',first_name:'Chris',email:'test@example.test' } : { content:'Hi {{contact.first_name}}',subject:'Project update' }, error:null }) };
    return query;
  } };
  const original = globalThis.fetch;
  let payload: any;
  try {
    globalThis.fetch = ((_url: unknown, options: RequestInit) => { payload = JSON.parse(String(options.body)); return Promise.resolve(new Response(JSON.stringify({ success:false, error:'Provider rejected' }))); }) as typeof fetch;
    const result = await runAction(admin, { type:'send_email_template',params:{template_slug:'Update',to_field:'contact.email'} },{id:'run-a',company_id:'tenant-a',entity_type:'contact',entity_id:'contact-a'});
    assert(result.status === 'failed'); assert(payload.tenant_id === 'tenant-a' && payload.to === 'test@example.test');
    assert(payload.html === 'Hi Chris'); assert(filters.filter(([key,value]) => key === 'tenant_id' && value === 'tenant-a').length === 2);
  } finally { globalThis.fetch = original; }
});
