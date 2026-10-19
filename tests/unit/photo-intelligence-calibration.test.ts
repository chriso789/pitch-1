import { describe, it, expect } from 'vitest';
import { calibrateThresholds, evaluateThresholds, type CalibrationExample } from '@/lib/photo-intelligence/components/calibration';

const ex = (id: string, cls: any, prop: string, v: number[]): CalibrationExample => ({ id, cls, propertyKey: prop, embedding: Float32Array.from(v), libraryVersion: 1, sourcePhotoId: id, sourceRegionId: id, approvedBy: 'b' });

describe('property-separated calibration', () => {
  it('blocks with a single property', () => {
    const r = calibrateThresholds([ex('a', 'clay_tile', 'p1', [1, 0]), ex('b', 'clay_tile', 'p1', [1, 0])]);
    expect(r.chosen).toBeNull();
    expect(r.uniqueProperties).toBe(1);
  });
  it('never scores an example against its own property', () => {
    const r = evaluateThresholds([ex('a', 'clay_tile', 'p1', [1, 0]), ex('b', 'metal_panel', 'p2', [0, 1])], { minSimilarity: 0.5, minMargin: 0 });
    expect(r.evaluated).toBe(0);
  });
  it('chooses measured thresholds on separable classes', () => {
    const data = [ex('a', 'clay_tile', 'p1', [1, 0.1]), ex('b', 'clay_tile', 'p2', [1, 0.05]), ex('c', 'metal_panel', 'p1', [0.1, 1]), ex('d', 'metal_panel', 'p2', [0.05, 1])];
    const r = calibrateThresholds(data);
    expect(r.chosen?.coverageAccuracy).toBe(1);
    expect(r.chosen?.wrong).toBe(0);
  });
});
