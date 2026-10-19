/**
 * Property-separated threshold calibration for the reference classifier.
 *
 * Leave-one-property-out: every example is classified against a library
 * built ONLY from other properties, so scores reflect unseen properties.
 * Thresholds are chosen from measured results, never kept as constants.
 */
import { classifyRegion, type ClassificationThresholds, type ReferenceExample, type VersionedReferenceLibrary } from './referenceClassifier';

export interface CalibrationExample extends ReferenceExample { propertyKey: string }

export interface ThresholdResult {
  thresholds: ClassificationThresholds;
  evaluated: number;
  correct: number;
  wrong: number;
  unknown: number;
  /** correct / (correct + wrong) — of the labels actually claimed. */
  precision: number | null;
  /** correct / evaluated — unknown counts as a miss. */
  coverageAccuracy: number | null;
  perClass: { cls: string; support: number; correct: number; predicted: number; precision: number | null; recall: number | null }[];
}

export interface CalibrationReport {
  approvedExamples: number;
  uniqueProperties: number;
  /** Examples whose class exists at some OTHER property (otherwise not evaluable). */
  evaluable: number;
  grid: ThresholdResult[];
  chosen: ThresholdResult | null;
  /** Why no thresholds were chosen, if so. */
  blockedReason?: string;
}

export const SIMILARITY_GRID = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
export const MARGIN_GRID = [0, 0.02, 0.05, 0.08, 0.12];

export function evaluateThresholds(examples: CalibrationExample[], thresholds: ClassificationThresholds, modelId = 'dinov2-small'): ThresholdResult {
  let correct = 0, wrong = 0, unknown = 0, evaluated = 0;
  const stats = new Map<string, { support: number; correct: number; predicted: number }>();
  const s = (c: string) => { if (!stats.has(c)) stats.set(c, { support: 0, correct: 0, predicted: 0 }); return stats.get(c)!; };
  for (const ex of examples) {
    const others = examples.filter((o) => o.propertyKey !== ex.propertyKey);
    if (!others.some((o) => o.cls === ex.cls)) continue;
    const lib: VersionedReferenceLibrary = { version: 0, embeddingModelId: modelId, examples: others };
    const r = classifyRegion(ex.embedding, lib, thresholds);
    evaluated++; s(ex.cls).support++;
    if (r.kind === 'unknown') { unknown++; continue; }
    s(r.cls).predicted++;
    if (r.cls === ex.cls) { correct++; s(ex.cls).correct++; } else wrong++;
  }
  return {
    thresholds, evaluated, correct, wrong, unknown,
    precision: correct + wrong ? correct / (correct + wrong) : null,
    coverageAccuracy: evaluated ? correct / evaluated : null,
    perClass: [...stats].map(([cls, v]) => ({ cls, ...v, precision: v.predicted ? v.correct / v.predicted : null, recall: v.support ? v.correct / v.support : null })),
  };
}

/**
 * Grid-search thresholds. Chooses the setting with the highest coverage
 * accuracy among those whose claimed-label precision ≥ minPrecision.
 */
export function calibrateThresholds(examples: CalibrationExample[], minPrecision = 0.9): CalibrationReport {
  const uniqueProperties = new Set(examples.map((e) => e.propertyKey)).size;
  const base = { approvedExamples: examples.length, uniqueProperties };
  if (uniqueProperties < 2) return { ...base, evaluable: 0, grid: [], chosen: null, blockedReason: 'Need approved examples from at least 2 properties to test on an unseen property.' };
  const grid: ThresholdResult[] = [];
  for (const minSimilarity of SIMILARITY_GRID) for (const minMargin of MARGIN_GRID) grid.push(evaluateThresholds(examples, { minSimilarity, minMargin }));
  const evaluable = grid[0]?.evaluated ?? 0;
  if (!evaluable) return { ...base, evaluable, grid, chosen: null, blockedReason: 'No class appears at more than one property yet.' };
  const ok = grid.filter((g) => g.precision !== null && g.precision >= minPrecision && g.correct > 0);
  const chosen = ok.sort((a, b) => (b.coverageAccuracy ?? 0) - (a.coverageAccuracy ?? 0))[0] ?? null;
  return { ...base, evaluable, grid, chosen, blockedReason: chosen ? undefined : `No threshold reached ${Math.round(minPrecision * 100)}% precision on unseen properties.` };
}
