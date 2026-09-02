// Canonical roofing blueprint engine entrypoint.
// Prevents outline + facet double-counting by preferring calibrated facets when both exist.

import {
  buildRoofingTakeoff,
  type RoofingTakeoffInput,
  type RoofingTakeoffResult,
} from "./blueprint-roofing-takeoff.ts";

export function buildSafeRoofingTakeoff(input: RoofingTakeoffInput): RoofingTakeoffResult {
  const evidence = input.geometry_evidence ?? [];
  const facetKeys = new Set(
    evidence
      .filter((g) => g.geometry_class === "facet")
      .map((g) => `${g.page_number}|${g.viewport_key}`),
  );

  const filtered = evidence.filter((geometry) => {
    if (geometry.geometry_class !== "outline") return true;
    return !facetKeys.has(`${geometry.page_number}|${geometry.viewport_key}`);
  });

  const result = buildRoofingTakeoff({ ...input, geometry_evidence: filtered });
  const removedOutlineCount = evidence.length - filtered.length;
  if (removedOutlineCount > 0) {
    result.review_flags.push({
      flag_code: "ROOF_OUTLINE_AREA_SUPERSEDED_BY_FACETS",
      severity: "info",
      blocking: false,
      message: `${removedOutlineCount} roof outline area candidate(s) were excluded because calibrated facet geometry exists for the same viewport.`,
      metadata: { removed_outline_count: removedOutlineCount },
    });
  }
  return result;
}
