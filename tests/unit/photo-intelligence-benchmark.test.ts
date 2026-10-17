import { describe, it, expect } from 'vitest';
import { scoreRecognition, scoreAssociation, type BenchmarkDetection } from '@/lib/photo-intelligence/benchmark';

const photos = [{ photoId: 'p1', input: 'unannotated_original' as const, labelsReviewed: true }];
const label: BenchmarkDetection = { photoId: 'p1', category: 'missing-shingles', box: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 } };
describe('independent recognition benchmark', () => {
  it('never claims independent accuracy from annotated or masked images', () => {
    for (const input of ['annotated_reference', 'annotation_masked'] as const) expect(() => scoreRecognition([{ ...photos[0], input }], [label], [label])).toThrow(/unannotated originals/);
    expect(() => scoreRecognition([{ ...photos[0], labelsReviewed: false }], [label], [label])).toThrow(/inspector-reviewed/);
  });
  it('counts duplicates as false positives and misses as false negatives, with category metrics', () => {
    const score = scoreRecognition(photos, [label, { ...label, category: 'torn-siding' }], [label, label]);
    expect(score.truePositive).toBe(1); expect(score.falsePositive).toBe(1); expect(score.falseNegative).toBe(1);
    expect(score.precision).toBe(0.5); expect(score.recall).toBe(0.5);
    expect(score.perCategory.find((c) => c.category === 'torn-siding')?.falseNegative).toBe(1);
  });
  it('does not claim perfect detection for empty or hard-negative sets', () => {
    expect(scoreRecognition(photos, [], []).precision).toBeNull();
    expect(scoreRecognition(photos, [], [label]).falsePositive).toBe(1);
    expect(scoreRecognition(photos, [label], []).recall).toBe(0);
  });
  it('measures false physical-identity merges separately from defect classification', () => {
    expect(scoreAssociation(['area-A', 'area-A', 'area-B'], ['all', 'all', 'all'])).toEqual({ truePositivePairs: 1, falseMerges: 2, falseSplits: 0, precision: 1 / 3, recall: 1 });
  });
});