import { describe, it, expect } from 'vitest';
import { buildDatasetVersion, toCoco, toYoloLabel, validatePhoto, type TrainingPhoto } from './dataset';
import { conditionKind, isValidClassForSystem } from './taxonomy';
import { evaluate, promotableClasses } from './evaluation';
import { experimentReadiness } from './conditions';

const polygon = [{ x: .1, y: .1 }, { x: .4, y: .1 }, { x: .4, y: .4 }];
const photo = (cls: string): TrainingPhoto => ({ photoId: 'a', propertyId: 'roof-a', sha256: 'hash-a', fileName: 'a.jpg', width: 100, height: 100, roofSystem: 'clay_tile', regions: [{ cls, polygon }], noVisibleDamage: false, status: 'approved', labeledBy: 'one', approvedBy: 'two' });
describe('balanced condition rules', () => {
  it('clay tiles include normal groups, damage, maintenance, uncertain and not assessable', () => {
    for (const cls of ['normal_tile_alignment', 'cracked_tile', 'maintenance_debris', 'uncertain_close_up_required', 'not_assessable_glare']) expect(isValidClassForSystem('clay_tile', cls)).toBe(true);
    expect(conditionKind('normal_shadow')).toBe('normal');
    expect(conditionKind('deteriorated_mortar')).toBe('maintenance');
  });
  it('uncertain observations remain in review but never become training background', () => {
    const ds = buildDatasetVersion('v', [photo('not_assessable_glare')], 0, 'now', 0);
    expect(ds.photos).toHaveLength(1);
    expect(toCoco(ds).images).toHaveLength(0);
    expect(() => toYoloLabel(ds.photos[0])).toThrow(/review/);
    expect(experimentReadiness(ds).experimental).toBe(false);
  });
  it('one approved normal region can start an internal experiment, never production', () => {
    const ds = buildDatasetVersion('v', [photo('normal_tile_alignment')], 0, 'now', 0);
    expect(experimentReadiness(ds)).toMatchObject({ experimental: true, production: false, validation: false });
    expect(toCoco(ds).annotations).toHaveLength(1);
  });
  it('no visible concern cannot coexist with maintenance or uncertainty', () => {
    expect(validatePhoto({ ...photo('maintenance_debris'), noVisibleDamage: true })).toBe('negative_with_regions');
    expect(validatePhoto({ ...photo('uncertain_close_up_required'), noVisibleDamage: true })).toBe('negative_with_regions');
    expect(validatePhoto({ ...photo('normal_tile_alignment'), noVisibleDamage: true })).toBeNull();
  });
  it('false defects on normal photos count as false positives and missed serious defects count as false negatives', () => {
    const ds = buildDatasetVersion('v', [photo('normal_tile_alignment'), { ...photo('broken_tile'), photoId: 'b', sha256: 'h-b', propertyId: 'roof-b' }], 1);
    const report = evaluate(ds, [{ photoId: 'a', cls: 'cracked_tile', confidence: .95, box: { x0: .1, y0: .1, x1: .4, y1: .4 } }]);
    expect(report.damageFalsePositivesOnNormalPhotos).toBe(1);
    expect(report.normalPhotosEvaluated).toBe(1);
    expect(report.bySystem.clay_tile.broken_tile.fn).toBe(1);
    expect(report.byCondition.damage).toMatchObject({ fp: 1, fn: 1 });
    expect(promotableClasses(report)).toEqual([]);
  });
  it('uncertainty is not counted as a measured correct condition', () => {
    const ds = buildDatasetVersion('v', [photo('uncertain_close_up_required')], 1);
    expect(evaluate(ds, []).reviewOnlyPhotos).toBe(1);
    expect(evaluate(ds, []).photosEvaluated).toBe(0);
  });
});