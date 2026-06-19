import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import {
  saveScanSession,
  loadScanSession,
  purgeExpiredScanSessions,
  listScanSessions,
  clearAllScanSessions,
  getScanStorageUsage,
  makeSessionId,
  type PersistedScanSession,
} from '@/utils/scannerSessionStore';

function makeSession(
  pipelineEntryId: string,
  documentType: string,
  bytes: number,
): PersistedScanSession {
  return {
    id: makeSessionId(pipelineEntryId, documentType),
    scannerSessionId: 'scn_test',
    pipelineEntryId,
    documentType,
    documentLabel: 'Test Doc',
    scanPreset: 'contract',
    pdfProfile: 'standard',
    pages: [
      {
        blob: new Blob(['x'.repeat(bytes)], { type: 'image/jpeg' }),
        cropMode: 'auto',
        colorMode: 'bw',
        preset: 'contract',
        pageSize: 'letter',
        deskewAngle: 0,
        confidence: 0.9,
        outputWidth: 100,
        outputHeight: 100,
        sourceWidth: 100,
        sourceHeight: 100,
        rotationApplied: 0,
        captureMethod: 'video_frame_canvas',
        shadowSeverity: 'none',
        blurOverridden: false,
      },
    ],
    updatedAt: Date.now(),
    scannerVersion: 'test',
  };
}

beforeEach(async () => {
  await clearAllScanSessions();
});

describe('scannerSessionStore — TTL & quota', () => {
  it('persists and reloads an active session', async () => {
    const s = makeSession('entry-1', 'contract', 1024);
    const res = await saveScanSession(s);
    expect(res.ok).toBe(true);
    const loaded = await loadScanSession('entry-1', 'contract');
    expect(loaded?.pages.length).toBe(1);
  });

  it('purges sessions older than the TTL', async () => {
    const fresh = makeSession('entry-fresh', 'contract', 512);
    await saveScanSession(fresh);

    // Force a stale row by writing directly with an old updatedAt.
    const stale = makeSession('entry-stale', 'contract', 512);
    const db = await openDB('pitch-scanner-sessions', 1);
    await db.put('sessions', { ...stale, updatedAt: Date.now() - 1000 * 60 * 60 * 48 });
    db.close();

    const purged = await purgeExpiredScanSessions(1000 * 60 * 60 * 24);
    expect(purged).toBeGreaterThanOrEqual(1);
    const remaining = (await listScanSessions()).map((s) => s.id);
    expect(remaining).toContain(fresh.id);
    expect(remaining).not.toContain(stale.id);
  });

  it('rejects saves that would breach the quota', async () => {
    const big = makeSession('entry-big', 'contract', 2_000_000);
    const res = await saveScanSession(big, { maxTotalBytes: 1_000_000 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('quota_exceeded');
  });

  it('clears all sessions and reports usage', async () => {
    await saveScanSession(makeSession('a', 'contract', 1024));
    await saveScanSession(makeSession('b', 'contract', 1024));
    expect((await listScanSessions()).length).toBe(2);
    const usage = await getScanStorageUsage();
    expect(usage.quota).toBeGreaterThan(0);
    const cleared = await clearAllScanSessions();
    expect(cleared).toBe(2);
    expect((await listScanSessions()).length).toBe(0);
  });
});
