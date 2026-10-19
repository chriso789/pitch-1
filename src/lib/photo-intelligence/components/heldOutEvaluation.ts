/**
 * Three-way property-separated evaluation for the reference classifier.
 *
 *   reference properties   → the library examples are drawn from here
 *   calibration properties → thresholds are chosen here
 *   test properties        → reported once with the chosen thresholds
 *
 * A property appears in exactly one split, and test properties never
 * influence threshold choice. Small splits are labelled experimental.
 */
import { classifyRegion, HARD_NEGATIVE_CLASSES, type ClassificationThresholds, type VersionedReferenceLibrary } from './referenceClassifier';
import { MARGIN_GRID, SIMILARITY_GRID, type CalibrationExample } from './calibration';

export type SplitName = 'reference' | 'calibration' | 'test';

/** Deterministic hash so a property never moves between splits across runs. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h / 4294967296;
}

/** Assign each property to one split (~60/20/20), ordered by a stable hash. */
export function splitProperties(keys: string[]): Map<string, SplitName> {
  const uniq = [...new Set(keys)].sort((a, b) => hash01(a) - hash01(b) || a.localeCompare(b));
  const out = new Map<string, SplitName>();
  const n = uniq.length;
  const nTest = n >= 3 ? Math.max(1, Math.round(n * 0.2)) : 0;
  const nCal = n >= 3 ? Math.max(1, Math.round(n * 0.2)) : 0;
  uniq.forEach((k, i) => out.set(k, i < nTest ? 'test' : i < nTest + nCal ? 'calibration' : 'reference'));
  return out;
}

export interface SplitMetrics {
  thresholds: ClassificationThresholds;
  evaluated: number; correct: number; wrong: number; unknown: number;
  /** Hard-negative examples (shadow, debris…) that were named as a roof component. */
  falsePositives: number;
  /** Unknown answers on examples whose class is absent from the library. */
  correctRejections: number;
  precision: number | null;
  coverageAccuracy: number | null;
  perClass: { cls: string; support: number; properties: number; correct: number; predicted: number; precision: number | null; recall: number | null }[];
}

export function evaluateSplit(library: CalibrationExample[], queries: CalibrationExample[], thresholds: ClassificationThresholds, modelId = 'dinov2-small'): SplitMetrics {
  const lib: VersionedReferenceLibrary = { version: 0, embeddingModelId: modelId, examples: library };
  const libClasses = new Set(library.map((e) => e.cls));
  const hn = new Set<string>(HARD_NEGATIVE_CLASSES);
  let correct = 0, wrong = 0, unknown = 0, fp = 0, rej = 0, evaluated = 0;
  const st = new Map<string, { support: number; props: Set<string>; correct: number; predicted: number }>();
  const s = (c: string) => { if (!st.has(c)) st.set(c, { support: 0, props: new Set(), correct: 0, predicted: 0 }); return st.get(c)!; };
  for (const q of queries) {
    const r = classifyRegion(q.embedding, lib, thresholds);
    if (!libClasses.has(q.cls)) { if (r.kind === 'unknown') rej++; else if (r.kind === 'component' && hn.has(q.cls)) fp++; continue; }
    evaluated++; s(q.cls).support++; s(q.cls).props.add(q.propertyKey);
    if (r.kind === 'unknown') { unknown++; continue; }
    s(r.cls).predicted++;
    if (r.cls === q.cls) { correct++; s(q.cls).correct++; } else { wrong++; if (hn.has(q.cls) && r.kind === 'component') fp++; }
  }
  return {
    thresholds, evaluated, correct, wrong, unknown, falsePositives: fp, correctRejections: rej,
    precision: correct + wrong ? correct / (correct + wrong) : null,
    coverageAccuracy: evaluated ? correct / evaluated : null,
    perClass: [...st].map(([cls, v]) => ({ cls, support: v.support, properties: v.props.size, correct: v.correct, predicted: v.predicted, precision: v.predicted ? v.correct / v.predicted : null, recall: v.support ? v.correct / v.support : null })),
  };
}

export const MIN_TEST_PROPERTIES_FOR_NON_EXPERIMENTAL = 5;

export interface HeldOutReport {
  splits: Record<SplitName, { properties: number; examples: number }>;
  chosen: ClassificationThresholds | null;
  calibration: SplitMetrics | null;
  test: SplitMetrics | null;
  experimental: boolean;
  blockedReason?: string;
}

/**
 * Choose thresholds on calibration properties only (highest coverage among
 * settings with precision ≥ minPrecision), then score test properties once.
 */
export function heldOutEvaluation(examples: CalibrationExample[], minPrecision = 0.9): HeldOutReport {
  const split = splitProperties(examples.map((e) => e.propertyKey));
  const by = (n: SplitName) => examples.filter((e) => split.get(e.propertyKey) === n);
  const ref = by('reference'), cal = by('calibration'), test = by('test');
  const count = (n: SplitName, xs: CalibrationExample[]) => ({ properties: [...split.values()].filter((v) => v === n).length, examples: xs.length });
  const splits = { reference: count('reference', ref), calibration: count('calibration', cal), test: count('test', test) };
  const base = { splits, experimental: splits.test.properties < MIN_TEST_PROPERTIES_FOR_NON_EXPERIMENTAL };
  if (split.size < 3) return { ...base, chosen: null, calibration: null, test: null, experimental: true, blockedReason: 'Need approved examples from at least 3 properties (reference, calibration and test).' };
  let best: SplitMetrics | null = null;
  for (const minSimilarity of SIMILARITY_GRID) for (const minMargin of MARGIN_GRID) {
    const m = evaluateSplit(ref, cal, { minSimilarity, minMargin });
    if (m.precision === null || m.precision < minPrecision || m.correct === 0) continue;
    if (!best || (m.coverageAccuracy ?? 0) > (best.coverageAccuracy ?? 0)) best = m;
  }
  if (!best) return { ...base, chosen: null, calibration: null, test: null, blockedReason: `No threshold reached ${Math.round(minPrecision * 100)}% precision on calibration properties.` };
  return { ...base, chosen: best.thresholds, calibration: best, test: evaluateSplit(ref, test, best.thresholds) };
}
