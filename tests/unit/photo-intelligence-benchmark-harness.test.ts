import { describe, expect, it } from 'vitest';
import { scoreBenchmarkSet, type BenchmarkItem } from '@/lib/photo-intelligence/benchmarkHarness';

const item = (id: string, over: Partial<BenchmarkItem>): BenchmarkItem => ({
  id, set_id: 's1', storage_path: 't/b/x', property_key: 'prop-1', material: 'clay_tile',
  scene_kind: 'intact', component_labels: [], labels_reviewed: true, labeled_by: 'a', reviewed_by: 'b', url: null,
  ...over,
});

describe('benchmark harness scoring', () => {
  it('refuses to score unreviewed labels', () => {
    expect(() => scoreBenchmarkSet([item('p1', { labels_reviewed: false, reviewed_by: null })], [])).toThrow(/reviewed/);
  });

  it('scores only reviewed items and reports property coverage', () => {
    const items = [
      item('p1', { property_key: 'prop-1', component_labels: [{ photoId: 'p1', category: 'clay_tile', box: { x: 0, y: 0, width: 0.5, height: 0.5 } }] }),
      item('p2', { property_key: 'prop-2', scene_kind: 'shadowed', component_labels: [] }),
      item('p3', { property_key: 'prop-3', labels_reviewed: false, reviewed_by: null }),
    ];
    const r = scoreBenchmarkSet(items, [{ photoId: 'p1', category: 'clay_tile', box: { x: 0, y: 0, width: 0.5, height: 0.5 } }]);
    expect(r.photosEvaluated).toBe(2);
    expect(r.properties).toBe(2);
    expect(r.bySceneKind.map((k) => k.kind).sort()).toEqual(['intact', 'shadowed']);
    expect(r.macroRecall).toBeCloseTo(1);
    expect(r.classifierKind).toBe('experimental_reference');
  });

  it('normalizes stored labels onto their own item id', () => {
    const items = [item('p1', { component_labels: [{ photoId: '', category: 'roof_vent', box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }] })];
    const r = scoreBenchmarkSet(items, [{ photoId: 'p1', category: 'unknown', box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }]);
    expect(r.unknownRejection.missedComponents).toBe(1);
  });
});
