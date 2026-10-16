import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { classifyUploadError, withUploadRetry, UploadFailure } from '@/lib/scan-records/uploadRetry';
import { getOrCreateUploadId, clearUploadId, scanUploadPaths } from '@/lib/scan-records/uploadIdentity';
import { saveScanSession, loadScanSession, purgeExpiredScanSessions, clearScanSession, type PersistedScanPage } from '@/utils/scannerSessionStore';

const noSleep = async () => {};

/** Fake server: storage keyed by path (upsert), documents unique on client_upload_id. */
function fakeServer() {
  const files = new Map<string, number>(); const rows = new Map<string, { tenant: string }>();
  return {
    files, rows,
    upload(path: string) { files.set(path, (files.get(path) ?? 0) + 1); },
    insert(uploadId: string, tenant: string) {
      if (rows.has(uploadId)) throw { code: '23505', message: 'duplicate key' };
      rows.set(uploadId, { tenant });
    },
  };
}

describe('Milestone B — error classification', () => {
  it.each([
    [{ name: 'TypeError', message: 'Failed to fetch' }, 'network'],
    [{ status: 503, message: 'unavailable' }, 'network'],
    [{ status: 401, message: 'JWT expired' }, 'auth_expired'],
    [{ status: 413, message: 'Payload too large' }, 'quota'],
    [{ name: 'QuotaExceededError', message: 'x' }, 'quota'],
    [{ code: '23505', message: 'duplicate key' }, 'duplicate'],
    [{ status: 403, message: 'new row violates row-level security policy' }, 'permission'],
    [{ status: 400, message: 'bad' }, 'permanent'],
  ])('%o → %s', (e, kind) => expect(classifyUploadError(e)).toBe(kind));
});

describe('Milestone B — retry without duplicates', () => {
  it('network drop mid-upload then reconnect: same paths, one row', async () => {
    const srv = fakeServer(); const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as unknown as Storage;
    let drops = 2;
    const attempt = async () => {
      const id = getOrCreateUploadId('tA', 'lead1', 'contract', ls);
      const p = scanUploadPaths('tA', 'lead1', id, 'contract', 5);
      await withUploadRetry(async () => { if (drops-- > 0) throw { name: 'TypeError', message: 'Failed to fetch' }; srv.upload(p.pdf); }, { sleep: noSleep });
      for (const o of p.originals) srv.upload(o);
      const r = await withUploadRetry(async () => srv.insert(id, 'tA'), { sleep: noSleep });
      return { id, r };
    };
    const first = await attempt();
    // user taps retry after page reload — id comes back from storage, server already has the row
    const second = await attempt();
    expect(second.id).toBe(first.id);
    expect(second.r.duplicate).toBe(true);
    expect(srv.rows.size).toBe(1);
    expect([...srv.files.keys()].filter(k => k.endsWith('.pdf'))).toHaveLength(1);
    expect([...srv.files.keys()].filter(k => k.includes('_originals/'))).toHaveLength(5);
    clearUploadId('tA', 'lead1', 'contract', ls);
    expect(getOrCreateUploadId('tA', 'lead1', 'contract', ls)).not.toBe(first.id);
  });
  it('expired session refreshes once then succeeds', async () => {
    let refreshed = 0, calls = 0;
    const r = await withUploadRetry(async () => { calls++; if (!refreshed) throw { status: 401, message: 'JWT expired' }; return 'ok'; },
      { refreshSession: async () => { refreshed++; return true; }, sleep: noSleep });
    expect(r.value).toBe('ok'); expect(refreshed).toBe(1); expect(calls).toBe(2);
  });
  it('failed refresh stops with auth_expired (pages kept by caller)', async () => {
    await expect(withUploadRetry(async () => { throw { status: 401, message: 'JWT expired' }; }, { refreshSession: async () => false, sleep: noSleep }))
      .rejects.toMatchObject({ kind: 'auth_expired' });
  });
  it('quota errors are not retried', async () => {
    let calls = 0;
    await expect(withUploadRetry(async () => { calls++; throw { status: 413, message: 'Payload too large' }; }, { sleep: noSleep })).rejects.toBeInstanceOf(UploadFailure);
    expect(calls).toBe(1);
  });
  it('gives up after the retry limit while offline', async () => {
    let calls = 0;
    await expect(withUploadRetry(async () => { calls++; throw { name: 'TypeError', message: 'Failed to fetch' }; }, { retries: 3, sleep: noSleep })).rejects.toMatchObject({ kind: 'network' });
    expect(calls).toBe(4);
  });
  it('upload ids are separate per company tab', () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as unknown as Storage;
    const a = getOrCreateUploadId('companyA', 'lead1', 'contract', ls);
    const b = getOrCreateUploadId('companyB', 'lead1', 'contract', ls);
    expect(a).not.toBe(b);
    expect(scanUploadPaths('companyA', 'lead1', a, 'contract', 1).pdf.startsWith('companyA/')).toBe(true);
    expect(scanUploadPaths('companyB', 'lead1', b, 'contract', 1).pdf.startsWith('companyB/')).toBe(true);
  });
});

describe('Milestone B — draft recovery after reload/background', () => {
  const page = (n: number): PersistedScanPage => ({
    blob: new Blob([new Uint8Array(n)]), cropMode: 'auto', colorMode: 'color', preset: 'p', pageSize: 'letter', deskewAngle: 0,
    confidence: null, outputWidth: 1, outputHeight: 1, sourceWidth: 1, sourceHeight: 1, rotationApplied: 0,
    captureMethod: `page${n}`, shadowSeverity: 'none', blurOverridden: false,
  });
  const base = { scannerSessionId: 's', pipelineEntryId: 'lead9', documentType: 'contract', documentLabel: 'Contract', scanPreset: 'p', pdfProfile: 'x', scannerVersion: 'v' };

  it('reload restores pages in the user\'s reordered order', async () => {
    await saveScanSession({ ...base, id: 'lead9::contract', pages: [page(3), page(1), page(2)], updatedAt: 0 });
    const s = await loadScanSession('lead9', 'contract');
    expect(s?.pages.map(p => p.captureMethod)).toEqual(['page3', 'page1', 'page2']);
  });
  it('quota exceeded refuses the save and keeps the previous draft', async () => {
    const r = await saveScanSession({ ...base, id: 'lead9::contract', pages: [page(5000)], updatedAt: 0 }, { maxTotalBytes: 100 });
    expect(r).toMatchObject({ ok: false, reason: 'quota_exceeded' });
    expect((await loadScanSession('lead9', 'contract'))?.pages).toHaveLength(3);
  });
  it('expired drafts are purged; fresh ones survive', async () => {
    await saveScanSession({ ...base, id: 'old::contract', pipelineEntryId: 'old', pages: [page(1)], updatedAt: 0 });
    await new Promise(r => setTimeout(r, 5));
    expect(await purgeExpiredScanSessions(1)).toBeGreaterThanOrEqual(1);
    await saveScanSession({ ...base, id: 'lead9::contract', pages: [page(1)], updatedAt: 0 });
    expect(await purgeExpiredScanSessions(60_000)).toBe(0);
    expect(await loadScanSession('lead9', 'contract')).not.toBeNull();
    await clearScanSession('lead9', 'contract');
    expect(await loadScanSession('lead9', 'contract')).toBeNull();
  });
});
