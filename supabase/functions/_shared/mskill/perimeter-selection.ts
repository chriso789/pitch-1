// Roof perimeter selection hierarchy.
//
// Implements Part 7 of the pre-rewire verification: a fixed precedence over
// every available perimeter source. Math-only offset candidates CANNOT win
// "final"; they can only be "selected" while waiting for surface evidence,
// and the result is always labeled with confidence + reason.
//
// Hierarchy (highest first):
//   1. validated_surface         — DSM / point-cloud roof surface boundary
//   2. trusted_vendor_report     — EagleView / Roofr / Hover ingested polygon
//   3. legacy_pipeline_artifact  — legacy roof_measurements with valid provenance
//   4. ai_mask_boundary          — high-confidence vision roof mask
//   5. jurisdiction_roof_type    — soffit/eave rule with known jurisdiction+roof type
//   6. jurisdiction_default      — soffit/eave rule with known jurisdiction only
//   7. generic_fallback          — uniform math offset, lowest confidence

import type { SoffitConfidence } from "./soffit-eave-rules.ts";

export type PerimeterSource =
  | "validated_surface"
  | "trusted_vendor_report"
  | "legacy_pipeline_artifact"
  | "ai_mask_boundary"
  | "jurisdiction_roof_type"
  | "jurisdiction_default"
  | "generic_fallback";

export type PerimeterStatus = "final" | "selected" | "proposed" | "needs_review";

export interface PerimeterCandidate {
  id: string;
  source: PerimeterSource;
  geojson: unknown;
  area_sqft?: number | null;
  perimeter_ft?: number | null;
  confidence: SoffitConfidence;
  surface_refined?: boolean;
  imagery_verified?: boolean;
  validation_source?: string | null;
  reason?: string | null;
}

export interface SelectionResult {
  selected: PerimeterCandidate;
  status: PerimeterStatus;
  reason: string;
  rejected: { id: string; source: PerimeterSource; reason: string }[];
}

const RANK: Record<PerimeterSource, number> = {
  validated_surface: 100,
  trusted_vendor_report: 90,
  legacy_pipeline_artifact: 80,
  ai_mask_boundary: 70,
  jurisdiction_roof_type: 50,
  jurisdiction_default: 30,
  generic_fallback: 10,
};

/**
 * Pick a perimeter from the available candidates. The contract is:
 *
 *   - A candidate with `surface_refined=true` OR source ∈ {validated_surface,
 *     trusted_vendor_report} can earn status="final" if confidence ≥ medium.
 *   - All math-only candidates (jurisdiction_*, generic_fallback) are clamped
 *     to status ∈ {selected, proposed, needs_review} regardless of math
 *     plausibility.
 *   - If only generic_fallback exists, status="needs_review".
 */
export function selectPerimeter(candidates: PerimeterCandidate[]): SelectionResult {
  if (candidates.length === 0) {
    throw new Error("perimeter-selection: at least one candidate required");
  }

  const sorted = [...candidates].sort((a, b) => RANK[b.source] - RANK[a.source]);
  const winner = sorted[0];
  const losers = sorted.slice(1);

  let status: PerimeterStatus;
  let reason: string;

  const isSurfaceBacked =
    winner.surface_refined === true ||
    winner.source === "validated_surface" ||
    winner.source === "trusted_vendor_report";

  if (isSurfaceBacked && (winner.confidence === "medium" || winner.confidence === "high")) {
    status = "final";
    reason = `surface/vendor-backed perimeter (${winner.source}) with ${winner.confidence} confidence`;
  } else if (winner.source === "generic_fallback") {
    status = "needs_review";
    reason = "only a generic math-offset candidate exists; surface evidence required before final";
  } else if (
    winner.source === "jurisdiction_default" ||
    winner.source === "jurisdiction_roof_type"
  ) {
    status = "selected";
    reason = `soffit/eave rule candidate (${winner.source}); not final until surface or vendor evidence available`;
  } else {
    status = "selected";
    reason = `${winner.source} candidate selected; awaiting surface refinement to promote to final`;
  }

  return {
    selected: winner,
    status,
    reason,
    rejected: losers.map((l) => ({
      id: l.id,
      source: l.source,
      reason: `outranked by ${winner.source} (rank ${RANK[winner.source]} vs ${RANK[l.source]})`,
    })),
  };
}

/** Helper for guard tests / runtime assertions. */
export function isMathOnlyPerimeter(source: PerimeterSource): boolean {
  return (
    source === "jurisdiction_roof_type" ||
    source === "jurisdiction_default" ||
    source === "generic_fallback"
  );
}
