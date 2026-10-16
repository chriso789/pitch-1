/**
 * Milestone C — authenticated scan isolation harness.
 * Runs ONLY against real isolated test companies when these env vars are set:
 *   SCAN_SEC_SUPABASE_URL, SCAN_SEC_ANON_KEY,
 *   SCAN_SEC_A_EMAIL, SCAN_SEC_A_PASSWORD, SCAN_SEC_A_TENANT,
 *   SCAN_SEC_B_EMAIL, SCAN_SEC_B_PASSWORD, SCAN_SEC_B_TENANT
 * Without them every case is SKIPPED (reported as blocked). Mock tests never prove isolation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const env = (k: string) => process.env[k];
const READY = ['SCAN_SEC_SUPABASE_URL', 'SCAN_SEC_ANON_KEY', 'SCAN_SEC_A_EMAIL', 'SCAN_SEC_A_PASSWORD', 'SCAN_SEC_A_TENANT', 'SCAN_SEC_B_EMAIL', 'SCAN_SEC_B_PASSWORD', 'SCAN_SEC_B_TENANT'].every(env);
const d = READY ? describe : describe.skip;

async function login(email: string, password: string, tenant: string) {
  const c = createClient(env('SCAN_SEC_SUPABASE_URL')!, env('SCAN_SEC_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { 'x-pitch-tenant': tenant } } });
  const { error } = await c.auth.signInWithPassword({ email, password }); if (error) throw error; return c;
}

d('Milestone C — two-company scan isolation (live)', () => {
  let A: SupabaseClient, B: SupabaseClient; const tA = env('SCAN_SEC_A_TENANT')!, tB = env('SCAN_SEC_B_TENANT')!;
  const path = `${tA}/sec-harness/${crypto.randomUUID()}_contract.pdf`;
  let docId = '';
  beforeAll(async () => {
    A = await login(env('SCAN_SEC_A_EMAIL')!, env('SCAN_SEC_A_PASSWORD')!, tA);
    B = await login(env('SCAN_SEC_B_EMAIL')!, env('SCAN_SEC_B_PASSWORD')!, tB);
    const up = await A.storage.from('documents').upload(path, new Blob(['%PDF-1.4\n%%EOF']), { contentType: 'application/pdf' });
    if (up.error) throw up.error;
    const ins = await A.from('documents').insert({ tenant_id: tA, filename: 'sec.pdf', file_path: path, document_type: 'contract', metadata: { client_upload_id: crypto.randomUUID(), sec_harness: true } } as any).select('id').single();
    if (ins.error) throw ins.error; docId = ins.data.id;
  });
  it('company B cannot read company A document row by id', async () => {
    const r = await B.from('documents').select('id').eq('id', docId).maybeSingle(); expect(r.data).toBeNull();
  });
  it('company B cannot download company A searchable PDF', async () => {
    const r = await B.storage.from('documents').download(path); expect(r.data).toBeNull();
  });
  it('company B cannot sign a URL for company A file', async () => {
    const r = await B.storage.from('documents').createSignedUrl(path, 60); expect(r.data?.signedUrl ?? null).toBeNull();
  });
  it('forged tenant id on insert is refused', async () => {
    const r = await B.from('documents').insert({ tenant_id: tA, filename: 'x.pdf', file_path: `${tA}/forged.pdf`, document_type: 'contract' } as any);
    expect(r.error).not.toBeNull();
  });
  it('company B cannot upload into company A storage folder', async () => {
    const r = await B.storage.from('documents').upload(`${tA}/sec-harness/forged.pdf`, new Blob(['x'])); expect(r.error).not.toBeNull();
  });
  it('company B cannot modify or delete company A document', async () => {
    await B.from('documents').update({ filename: 'hacked.pdf' } as any).eq('id', docId);
    await B.from('documents').delete().eq('id', docId);
    const r = await A.from('documents').select('filename').eq('id', docId).single();
    expect(r.data?.filename).toBe('sec.pdf');
  });
  it('switching B to tenant A header does not grant access', async () => {
    const C = await login(env('SCAN_SEC_B_EMAIL')!, env('SCAN_SEC_B_PASSWORD')!, tA);
    const r = await C.from('documents').select('id').eq('id', docId).maybeSingle(); expect(r.data).toBeNull();
  });
});

describe('Milestone C — harness status', () => {
  it(READY ? 'live harness configured' : 'BLOCKED: no isolated test company credentials — live isolation NOT verified', () => {
    expect(typeof READY).toBe('boolean');
  });
});
