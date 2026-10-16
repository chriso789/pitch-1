import { describe, it, expect, vi } from 'vitest';
import { runBatch } from '@/lib/scan-restore/batchRunner';
import { chooseConcurrency, frameBytes, scanStorageBytes, workingBudgetBytes } from '@/lib/scan-records/memoryBudget';
import { rotatePoint, unrotatePoint, rotatedSize, normalizeRotation, pageOrientation, previewToSource } from '@/lib/scan-records/orientation';

describe('Milestone A — batch cleanup progress/cancel', () => {
  it('reports progress for every page and preserves order', async () => {
    const seen: number[] = [];
    const r = await runBatch([1, 2, 3, 4, 5], async (n) => n * 10, { concurrency: 2, onProgress: (p) => seen.push(p.done) });
    expect(r.results).toEqual([10, 20, 30, 40, 50]);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.cancelled).toBe(false);
  });
  it('cancel stops new pages; finished pages kept, unprocessed stay null', async () => {
    const ac = new AbortController();
    const r = await runBatch([0, 1, 2, 3], async (i) => { if (i === 1) ac.abort(); return i; }, { concurrency: 1, signal: ac.signal });
    expect(r.cancelled).toBe(true);
    expect(r.results).toEqual([0, 1, null, null]);
  });
  it('one failing page does not lose the others', async () => {
    const r = await runBatch([0, 1, 2], async (i) => { if (i === 1) throw new Error('decode'); return i; });
    expect(r.results).toEqual([0, null, 2]);
    expect(r.errors.map(e => e.index)).toEqual([1]);
  });
  it('never runs more than the concurrency limit at once', async () => {
    let live = 0, peak = 0;
    await runBatch(Array.from({ length: 8 }), async () => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 2)); live--; return 1; }, { concurrency: 3 });
    expect(peak).toBe(3);
  });
});

describe('Milestone A — memory budget', () => {
  it('a 12MP frame on a 2GB phone runs one page at a time', () => {
    expect(frameBytes(3000, 4000)).toBe(48_000_000);
    expect(chooseConcurrency(3000, 4000, 2)).toBe(1);
  });
  it('more memory allows more parallel pages, capped', () => {
    expect(chooseConcurrency(1000, 1400, 8)).toBe(4);
    expect(workingBudgetBytes(undefined)).toBe(64 * 1024 * 1024);
  });
  it('originals are counted separately and never dropped from storage totals', () => {
    const b = (n: number) => new Blob([new Uint8Array(n)]);
    const s = scanStorageBytes([{ blob: b(10), originalBlob: b(100) }, { blob: b(5), originalBlob: b(50) }]);
    expect(s).toEqual({ processed: 15, originals: 150, total: 165 });
  });
});

describe('Milestone A — portrait/landscape transforms', () => {
  const W = 800, H = 1200;
  const corners = [{ x: 10, y: 20 }, { x: 790, y: 15 }, { x: 780, y: 1190 }, { x: 5, y: 1180 }];
  for (const rot of [0, 90, 180, 270] as const) {
    it(`rotate ${rot}° round-trips crop corners exactly`, () => {
      const { width, height } = rotatedSize(W, H, rot);
      for (const c of corners) {
        const r = rotatePoint(c, W, H, rot);
        expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x).toBeLessThanOrEqual(width);
        expect(r.y).toBeGreaterThanOrEqual(0); expect(r.y).toBeLessThanOrEqual(height);
        expect(unrotatePoint(r, W, H, rot)).toEqual(c);
      }
    });
  }
  it('portrait page becomes landscape at 90/270 and keeps orientation at 180', () => {
    expect(pageOrientation(W, H)).toBe('portrait');
    const r90 = rotatedSize(W, H, 90); expect(pageOrientation(r90.width, r90.height)).toBe('landscape');
    const r180 = rotatedSize(W, H, 180); expect(pageOrientation(r180.width, r180.height)).toBe('portrait');
  });
  it('normalises device angles and maps preview taps to source pixels in both viewports', () => {
    expect(normalizeRotation(-90)).toBe(270); expect(normalizeRotation(450)).toBe(90); expect(normalizeRotation(359)).toBe(0);
    // portrait phone 390x844 preview of 3000x4000 photo; landscape 844x390 preview of 4000x3000
    expect(previewToSource({ x: 195, y: 422 }, 390, 844, 3000, 4000)).toEqual({ x: 1500, y: 2000 });
    expect(previewToSource({ x: 422, y: 195 }, 844, 390, 4000, 3000)).toEqual({ x: 2000, y: 1500 });
  });
});
