// Confidence scoring + review-queue thresholds for deterministic parsers.
// Tiers come from the document agent architecture doc.

export const CONFIDENCE_THRESHOLDS = {
  EXACT_LABEL: 0.97,        // labelled field, no ambiguity ("Total Roof Area = 2,450 sq ft")
  SUMMARY_SECTION: 0.88,    // parsed from a known vendor summary block
  TABLE_OR_REPEATED: 0.75,  // pulled from a table or repeated section
  WEAK: 0.55,               // single regex hit, no cross-validation
  REVIEW_FLOOR: 0.70,       // < this → requires human review (or AI fallback once enabled)
} as const;

export type FieldConfidence = Record<string, number>;

export function aggregateConfidence(fields: FieldConfidence): number {
  const values = Object.values(fields).filter((v) => Number.isFinite(v));
  if (values.length === 0) return 0;
  // Geometric mean — one weak field drags the score down.
  const product = values.reduce((acc, v) => acc * Math.max(v, 0.01), 1);
  return Math.pow(product, 1 / values.length);
}

export function requiresReview(overall: number, missing: string[]): boolean {
  return overall < CONFIDENCE_THRESHOLDS.REVIEW_FLOOR || missing.length > 0;
}
