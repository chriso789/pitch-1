import { describe, it, expect } from 'vitest';
import { diffMeasurements, type MeasureRow } from '@/lib/pdf-compare/measureDiff';

const m = (id: string, pts: [number, number][], value: number, label: string | null = null, status = 'approved'): MeasureRow =>
  ({ id, kind: 'linear', points: pts, value, unit: 'ft', label, status, scale_id: null });

describe('diffMeasurements', () => {
  it('classifies unchanged, value change, redrawn, added, removed', () => {
    const before = [m('a', [[0, 0], [10, 0]], 10), m('b', [[0, 5], [5, 5]], 5), m('c', [[1, 1], [2, 2]], 3, 'Wall A'), m('d', [[9, 9], [8, 8]], 1)];
    const after = [m('a2', [[0.2, 0], [10, 0.1]], 10), m('b2', [[0, 5], [5, 5]], 6), m('c2', [[1, 1], [4, 4]], 7, 'Wall A'), m('e', [[3, 3], [4, 4]], 2)];
    const t = diffMeasurements(before, after).map(c => c.type).sort();
    expect(t).toEqual(['added', 'removed', 'reshaped', 'unchanged', 'value_changed']);
  });
  it('ignores rejected measurements', () => {
    expect(diffMeasurements([m('a', [[0, 0], [1, 1]], 1, null, 'rejected')], [])).toEqual([]);
  });
});
