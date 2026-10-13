import { describe, it, expect } from 'vitest';
import { diffRasters, revisionReport, type Raster } from '@/lib/pdf-compare/diff';

const blank = (w = 100, h = 100): Raster => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
const box = (r: Raster, x0: number, y0: number, s: number) => { for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) { const i = (y * r.width + x) * 4; r.data[i] = r.data[i + 1] = r.data[i + 2] = 0; } return r; };

describe('revision diff', () => {
  it('identical pages have no changes', () => {
    expect(diffRasters(box(blank(), 10, 10, 20), box(blank(), 10, 10, 20)).regions).toHaveLength(0);
  });
  it('ignores isolated anti-aliasing pixels', () => {
    const b = blank(); for (let i = 0; i < 30; i++) { const p = ((i * 7 + 3) * 100 + i * 3 + 5) * 4; b.data[p] = b.data[p + 1] = b.data[p + 2] = 120; }
    expect(diffRasters(blank(), b).regions).toHaveLength(0);
  });
  it('detects added and deleted content', () => {
    const r = diffRasters(box(blank(), 10, 10, 15), box(blank(), 60, 60, 15));
    expect(r.regions.map(x => x.kind).sort()).toEqual(['added', 'deleted']);
    expect(revisionReport({ oldName: 'A', newName: 'B', page: 1 }, r.regions, { width: 100, height: 100 })).toContain('manual review');
  });
  it('manual offset aligns a shifted sheet', () => {
    expect(diffRasters(box(blank(), 10, 10, 20), box(blank(), 14, 12, 20), { dx: 4, dy: 2 }).regions).toHaveLength(0);
  });
});
