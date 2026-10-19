import { describe, it, expect } from 'vitest';
import { heldOutEvaluation, splitProperties } from '@/lib/photo-intelligence/components/heldOutEvaluation';
import { differenceHash, markDuplicates, recommendForLabeling, type TriagedPhoto } from '@/lib/photo-intelligence/components/photoTriage';
import { groupBySimilarity } from '@/lib/photo-intelligence/components/regionProposals';
import type { CalibrationExample } from '@/lib/photo-intelligence/components/calibration';

const ex = (id: string, cls: any, prop: string, v: number[]): CalibrationExample => ({ id, cls, propertyKey: prop, embedding: Float32Array.from(v), libraryVersion: 1, sourcePhotoId: id, sourceRegionId: id, approvedBy: 'b' });

describe('three-way property split', () => {
  it('puts each property in exactly one split and is stable', () => {
    const keys = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const a = splitProperties(keys), b = splitProperties([...keys].reverse());
    expect([...a]).toEqual([...b].sort((x, y) => [...a.keys()].indexOf(x[0]) - [...a.keys()].indexOf(y[0])));
    expect([...a.values()].filter((v) => v === 'test').length).toBe(2);
    expect([...a.values()].filter((v) => v === 'calibration').length).toBe(2);
  });
  it('blocks with fewer than 3 properties', () => {
    const r = heldOutEvaluation([ex('a', 'clay_tile', 'p1', [1, 0]), ex('b', 'clay_tile', 'p2', [1, 0])]);
    expect(r.chosen).toBeNull();
  });
  it('test examples never come from reference or calibration properties, and small test sets are experimental', () => {
    const data: CalibrationExample[] = [];
    for (let i = 0; i < 6; i++) { data.push(ex(`t${i}`, 'clay_tile', `p${i}`, [1, 0.05 * i])); data.push(ex(`m${i}`, 'metal_panel', `p${i}`, [0.05 * i, 1])); }
    const r = heldOutEvaluation(data);
    expect(r.splits.reference.properties + r.splits.calibration.properties + r.splits.test.properties).toBe(6);
    expect(r.experimental).toBe(true);
    expect(r.test?.evaluated).toBe(r.splits.test.examples);
  });
});

describe('photo triage', () => {
  const img = (f: (x: number) => number) => { const w = 64, h = 64, d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x); d.set([v, v, v, 255], (y * w + x) * 4); } return { width: w, height: h, data: d }; };
  it('identical images hash the same; different patterns differ', () => {
    expect(differenceHash(img((x) => x * 4))).toBe(differenceHash(img((x) => x * 4)));
    expect(differenceHash(img((x) => x * 4))).not.toBe(differenceHash(img((x) => 255 - x * 4)));
  });
  const t = (id: string, prop: string, hash: string, sharp: number, ok = true): TriagedPhoto => ({ id, propertyKey: prop, hash, sharpness: sharp, assessable: ok, issues: [], duplicateOf: null });
  it('keeps the sharper copy of a near-duplicate', () => {
    const r = markDuplicates([t('a', 'p1', 'ffff0000ffff0000', 1), t('b', 'p1', 'ffff0000ffff0001', 5)]);
    expect(r.find((p) => p.id === 'a')?.duplicateOf).toBe('b');
  });
  it('recommends across properties before repeating one, skipping poor photos', () => {
    const r = recommendForLabeling([t('a1', 'p1', '1', 9), t('a2', 'p1', '2', 8), t('b1', 'p2', '3', 1), t('c1', 'p3', '4', 5, false)], 2);
    expect(r.map((p) => p.id)).toEqual(['a1', 'b1']);
  });
});

describe('region grouping', () => {
  it('groups similar embeddings and separates different ones', () => {
    expect(groupBySimilarity([Float32Array.from([1, 0]), Float32Array.from([0.99, 0.05]), Float32Array.from([0, 1]), null])).toEqual([0, 0, 1, -1]);
  });
});
