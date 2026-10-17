import { describe, it, expect } from 'vitest';
import { buildDatasetVersion, toCoco, fromCoco, toYoloLabel, applyImportedLabels, type TrainingPhoto } from './training/dataset';
import { evaluate, promotableClasses } from './training/evaluation';
import { classIndex } from './training/taxonomy';

const sq = [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.3 }, { x: 0.1, y: 0.3 }];
const photo = (id: string, prop: string, o: Partial<TrainingPhoto> = {}): TrainingPhoto => ({
  photoId: id, sha256: `h-${id}`, propertyId: prop, roofSystem: 'clay_tile', width: 1000, height: 800, fileName: `${id}.jpg`,
  noVisibleDamage: false, regions: [{ cls: 'cracked_tile', polygon: sq }], status: 'approved', labeledBy: 'a', approvedBy: 'b', ...o,
});

describe('training dataset', () => {
  it('excludes unapproved, self-approved, wrong-system and duplicate photos; keeps negatives', () => {
    const ds = buildDatasetVersion('v1', [
      photo('1', 'p1'),
      photo('2', 'p1', { status: 'draft' }),
      photo('3', 'p1', { approvedBy: 'a' }),
      photo('4', 'p1', { regions: [{ cls: 'missing_shingles', polygon: sq }] }),
      photo('5', 'p1', { sha256: 'h-1' }),
      photo('6', 'p2', { noVisibleDamage: true, regions: [] }),
    ]);
    expect(ds.photos.map((p) => p.photoId)).toEqual(['1', '6']);
    expect(ds.excluded.map((e) => e.reason)).toEqual(['not_approved', 'self_approved', 'class_not_in_system:missing_shingles', 'duplicate_of:1']);
  });

  it('never splits one property across train and val', () => {
    const photos = Array.from({ length: 200 }, (_, i) => photo(`x${i}`, `prop${i % 40}`));
    const ds = buildDatasetVersion('v1', photos);
    const byProp = new Map<string, Set<string>>();
    for (const p of ds.photos) (byProp.get(p.propertyId) ?? byProp.set(p.propertyId, new Set()).get(p.propertyId)!).add(ds.split[p.photoId]);
    for (const s of byProp.values()) expect(s.size).toBe(1);
    expect(Object.values(ds.split)).toContain('val');
  });

  it('round-trips COCO and imported labels need re-approval', () => {
    const ds = buildDatasetVersion('v1', [photo('1', 'p1')], 0);
    const coco = toCoco(ds);
    coco.annotations[0].bbox.forEach((v: number, i: number) => expect(v).toBeCloseTo([100, 80, 200, 160][i]));
    const back = fromCoco(coco);
    expect(back.errors).toEqual([]);
    expect(back.regions['1'][0].cls).toBe('cracked_tile');
    expect(back.regions['1'][0].polygon[2].x).toBeCloseTo(0.3);
    const re = applyImportedLabels(ds.photos[0], back.regions['1'], 'c');
    expect(re.status).toBe('draft');
    expect(re.approvedBy).toBeNull();
  });

  it('writes YOLO segmentation lines and empty labels for negatives', () => {
    expect(toYoloLabel(photo('1', 'p1')).startsWith(`${classIndex('cracked_tile')} 0.100000 0.100000`)).toBe(true);
    expect(toYoloLabel(photo('2', 'p', { noVisibleDamage: true, regions: [] }))).toBe('');
  });
});

describe('evaluation', () => {
  const ds = buildDatasetVersion('v1', [photo('1', 'p1')], 1);
  it('refuses predictions on training photos', () => {
    const trainDs = buildDatasetVersion('v1', [photo('1', 'p1')], 0);
    expect(() => evaluate(trainDs, [{ photoId: '1', cls: 'cracked_tile', box: { x0: 0, y0: 0, x1: 1, y1: 1 }, confidence: 0.9 }])).toThrow(/training photos/);
  });
  it('scores TP/FP/FN per roof system', () => {
    const r = evaluate(ds, [
      { photoId: '1', cls: 'cracked_tile', box: { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }, confidence: 0.9 },
      { photoId: '1', cls: 'cracked_tile', box: { x0: 0.7, y0: 0.7, x1: 0.9, y1: 0.9 }, confidence: 0.6 },
    ]);
    expect(r.bySystem.clay_tile.cracked_tile).toMatchObject({ tp: 1, fp: 1, fn: 0, precision: 0.5, recall: 1 });
    expect(promotableClasses(r)).toEqual([]);
  });
});
