export interface RoofFootprintCandidate {
  source: string;
  coordinates: [number, number][];
  confidence: number;
  vertexCount: number;
  areaSqft?: number;
}

export interface RoofFootprintCandidateDecision {
  accepted: boolean;
  score: number;
  reason: string;
  areaRatio: number | null;
}

const SOURCE_SCORE: Record<string, number> = {
  mapbox_vector: 100,
  usa_structures: 96,
  microsoft_buildings: 94,
  osm_overpass: 90,
  osm_buildings: 90,
  ai_vision_detected: 72,
  google_solar_api: 65,
  regrid_parcel: 15,
  usa_parcels: 10,
  solar_bbox_fallback: 0,
};

export function isParcelLikeFootprintSource(source: string): boolean {
  return source === 'usa_parcels' || source === 'regrid_parcel';
}

export function evaluateRoofFootprintCandidate(
  candidate: RoofFootprintCandidate,
  solarAreaSqft?: number | null,
): RoofFootprintCandidateDecision {
  const source = candidate.source;
  const areaRatio =
    Number.isFinite(Number(candidate.areaSqft)) &&
    Number(candidate.areaSqft) > 0 &&
    Number.isFinite(Number(solarAreaSqft)) &&
    Number(solarAreaSqft) > 0
      ? Number(candidate.areaSqft) / Number(solarAreaSqft)
      : null;

  if (source === 'solar_bbox_fallback') {
    return { accepted: false, score: 0, reason: 'solar_bbox_is_diagnostic_only', areaRatio };
  }

  if (isParcelLikeFootprintSource(source)) {
    return { accepted: false, score: 0, reason: 'parcel_polygon_is_not_roof_footprint', areaRatio };
  }

  if (candidate.vertexCount < 4) {
    return { accepted: false, score: 0, reason: 'too_few_vertices', areaRatio };
  }

  if (areaRatio !== null && (areaRatio < 0.55 || areaRatio > 1.35)) {
    return {
      accepted: false,
      score: 0,
      reason: `area_ratio_outside_roof_bounds:${areaRatio.toFixed(2)}`,
      areaRatio,
    };
  }

  const sourceScore = SOURCE_SCORE[source] ?? 50;
  const confidenceScore = Math.max(0, Math.min(1, candidate.confidence || 0)) * 20;
  const detailScore = Math.min(Math.max(candidate.vertexCount - 4, 0), 12) * 1.5;
  const areaScore = areaRatio === null ? 8 : Math.max(0, 18 - Math.abs(1 - areaRatio) * 45);

  return {
    accepted: true,
    score: sourceScore + confidenceScore + detailScore + areaScore,
    reason: 'accepted_roof_footprint_candidate',
    areaRatio,
  };
}

export function pickBestRoofFootprintCandidate(
  candidates: RoofFootprintCandidate[],
  solarAreaSqft?: number | null,
): { candidate: RoofFootprintCandidate; decision: RoofFootprintCandidateDecision } | null {
  const scored = candidates
    .map((candidate) => ({ candidate, decision: evaluateRoofFootprintCandidate(candidate, solarAreaSqft) }))
    .filter((entry) => entry.decision.accepted)
    .sort((a, b) => b.decision.score - a.decision.score);

  return scored[0] ?? null;
}