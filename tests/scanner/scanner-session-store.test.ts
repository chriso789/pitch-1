import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
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
  ageMs = 0,
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
        blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
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
    updatedAt: Date.now() - ageMs,
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
    const stale = makeSession('entry-stale', 'contract', 512, 1000 * 60 * 60 * 48);
    await saveScanSession(fresh);
    await saveScanSession(stale);
    const purged = await purgeExpiredScanSessions(1000 * 60 * 60 * 24);
    expect(purged).toBe(1);
    expect((await listScanSessions()).map((s) => s.id)).toContain(fresh.id);
  });

  it('rejects saves that would breach the quota', async () => {
    const big = makeSession('entry-big', 'contract', 2_000_000);
    const res = await saveScanSession(big, { maxTotalBytes: 1_000_000 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('quota_exceeded');
  });

  it('reports usage and clears all sessions', async () => {
    await saveScanSession(makeSession('a', 'contract', 1024));
    await saveScanSession(makeSession('b', 'contract', 1024));
    const usage = await getScanStorageUsage();
    expect(usage.bytes).toBeGreaterThanOrEqual(2048);
    const cleared = await clearAllScanSessions();
    expect(cleared).toBe(2);
    expect((await listScanSessions()).length).toBe(0);
  });
});
