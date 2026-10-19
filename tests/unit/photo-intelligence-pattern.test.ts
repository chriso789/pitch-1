import { describe, it, expect } from 'vitest';
import { analyzePattern } from '@/lib/photo-intelligence/patternAnalysis';
import { validateDetections } from '@/lib/photo-intelligence/recognition';

/** Synthetic repeating "tile course" texture; optional dark patch. */
function tiles(w = 256, h = 256, patch?: { x: number; y: number; s: number }, flat = false) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let v = flat ? 128 : 120 + ((x % 16 < 2 || y % 12 < 2) ? -60 : 40) + ((x * 7 + y * 13) % 9);
    if (patch && x >= patch.x && x < patch.x + patch.s && y >= patch.y && y < patch.y + patch.s) v = 20;
    d[i] = v * 1.1; d[i + 1] = v * 0.7; d[i + 2] = v * 0.5; d[i + 3] = 255;
  }
  return { width: w, height: h, data: d };
}

describe('pattern analysis (no custom training)', () => {
  it('returns a valid "no unusual regions" result for a uniform pattern', () => {
    const out = analyzePattern(tiles());
    expect(out.status).toBe('no_unusual_regions');
    expect(out.result.detections).toHaveLength(0);
  });

  it('locates a disrupted area with real coordinates as a possible anomaly, never confirmed damage', () => {
    const out = analyzePattern(tiles(256, 256, { x: 96, y: 96, s: 32 }));
    expect(out.status).toBe('regions_found');
    const batch = validateDetections(out.result, { photoId: 'p', imageRef: 'x' });
    expect(batch.proposals.length).toBeGreaterThan(0);
    const p = batch.proposals[0];
    expect(p.damageCategory).toBe('possible_anomaly');
    expect(p.condition).toMatch(/Not confirmed damage/);
    expect(p.reviewStatus).toBe('pending');
    expect(p.confidence).toBeNull();
    if (p.annotation.kind === 'polygon') {
      const xs = p.annotation.points.map((q) => q.x);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0.3);
      expect(Math.max(...xs)).toBeLessThanOrEqual(0.6);
    }
  });

  it('reports blurry/flat photos as not assessable instead of "no concerns"', () => {
    const out = analyzePattern(tiles(256, 256, undefined, true));
    expect(out.status).toBe('not_assessable');
    expect(out.result.detections).toHaveLength(0);
  });
});
