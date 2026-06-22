// PR #5 — per-facet Solar pitch lookup.
// Uses Solar roofSegmentStats as a raw evidence cross-check only.

import { degreesToRiseOver12 } from "./consensus.ts";

export type PxPoint = [number, number];

export interface FacetPitchTarget {
  facet_id: string | number;
  polygon_px?: PxPoint[] | null;
  centroid_px?: PxPoint | null;
  azimuth_degrees?: number | null;
}

export interface SolarRoofSegmentLike {
  id?: string | number | null;
  pitchDegrees?: number | null;
  pitch_degrees?: number | null;
  azimuthDegrees?: number | null;
  azimuth_degrees?: number | null;
  centerPx?: PxPoint | null;
  center_px?: PxPoint | null;
  centroid_px?: PxPoint | null;
  polygonPx?: PxPoint[] | null;
  polygon_px?: PxPoint[] | null;
  stats?: { areaMeters2?: number | null; area_m2?: number | null } | null;
  areaMeters2?: number | null;
  area_m2?: number | null;
}

export interface SolarPitchLookupResult {
  facet_id: string | number;
  status: "matched" | "unavailable";
  pitch_degrees: number | null;
  pitch_rise_over_12: number | null;
  azimuth_degrees: number | null;
  solar_segment_id: string | null;
  confidence: number;
  match_reason: string | null;
  distance_px: number | null;
  azimuth_delta_deg: number | null;
  metadata: Record<string, unknown>;
}

export function lookupSolarPitchForFacet(
  facet: FacetPitchTarget,
  segments: SolarRoofSegmentLike[] | null | undefined,
): SolarPitchLookupResult {
  const available = (segments ?? []).filter((s) => Number.isFinite(resolvePitchDegrees(s)));
  if (!available.length) return unavailable(facet.facet_id, "solar_segments_missing_pitch");

  const facetCentroid = facet.centroid_px ?? (facet.polygon_px ? polygonCentroid(facet.polygon_px) : null);
  const scored = available.map((segment) => scoreSegmentMatch(facet, facetCentroid, segment))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score <= 0) return unavailable(facet.facet_id, "no_matching_solar_segment");

  const pitchDegrees = resolvePitchDegrees(best.segment)!;
  const azimuthDegrees = resolveAzimuthDegrees(best.segment);
  const rise = degreesToRiseOver12(pitchDegrees);
  const confidence = clamp01(0.55 + best.score * 0.35);

  return {
    facet_id: facet.facet_id,
    status: "matched",
    pitch_degrees: round(pitchDegrees, 3),
    pitch_rise_over_12: round(rise, 3),
    azimuth_degrees: round(azimuthDegrees, 3),
    solar_segment_id: best.segment.id == null ? null : String(best.segment.id),
    confidence: round(confidence, 4) ?? 0,
    match_reason: best.reason,
    distance_px: round(best.distance_px, 3),
    azimuth_delta_deg: round(best.azimuth_delta_deg, 3),
    metadata: {
      source: "solar_roofSegmentStats",
      area_m2: resolveAreaM2(best.segment),
      score: round(best.score, 4),
    },
  };
}

function scoreSegmentMatch(
  facet: FacetPitchTarget,
  facetCentroid: PxPoint | null,
  segment: SolarRoofSegmentLike,
): { segment: SolarRoofSegmentLike; score: number; reason: string; distance_px: number | null; azimuth_delta_deg: number | null } {
  const segCentroid = resolveSegmentCentroid(segment);
  const distancePx = facetCentroid && segCentroid ? distance(facetCentroid, segCentroid) : null;
  const azimuth = resolveAzimuthDegrees(segment);
  const azimuthDelta = facet.azimuth_degrees != null && azimuth != null
    ? circularDeltaDeg(facet.azimuth_degrees, azimuth)
    : null;

  let score = 0.35;
  const reasons: string[] = [];
  if (facetCentroid && segCentroid) {
    const distanceScore = Math.max(0, 1 - (distancePx ?? 9999) / 80);
    score += distanceScore * 0.45;
    reasons.push(`centroid_distance_px=${round(distancePx, 2)}`);
  }
  if (azimuthDelta != null) {
    const azimuthScore = Math.max(0, 1 - azimuthDelta / 90);
    score += azimuthScore * 0.20;
    reasons.push(`azimuth_delta_deg=${round(azimuthDelta, 2)}`);
  }
  if (!facetCentroid && !segCentroid && azimuthDelta == null) {
    reasons.push("pitch_only_fallback");
  }

  return {
    segment,
    score: clamp01(score),
    reason: reasons.join(";") || "solar_segment_match",
    distance_px: distancePx,
    azimuth_delta_deg: azimuthDelta,
  };
}

function resolvePitchDegrees(segment: SolarRoofSegmentLike): number | null {
  const v = Number(segment.pitchDegrees ?? segment.pitch_degrees);
  return Number.isFinite(v) && v >= 0 && v <= 75 ? v : null;
}

function resolveAzimuthDegrees(segment: SolarRoofSegmentLike): number | null {
  const v = Number(segment.azimuthDegrees ?? segment.azimuth_degrees);
  return Number.isFinite(v) ? normalizeDeg(v) : null;
}

function resolveAreaM2(segment: SolarRoofSegmentLike): number | null {
  const v = Number(segment.areaMeters2 ?? segment.area_m2 ?? segment.stats?.areaMeters2 ?? segment.stats?.area_m2);
  return Number.isFinite(v) ? v : null;
}

function resolveSegmentCentroid(segment: SolarRoofSegmentLike): PxPoint | null {
  const direct = segment.centerPx ?? segment.center_px ?? segment.centroid_px ?? null;
  if (direct && Number.isFinite(direct[0]) && Number.isFinite(direct[1])) return direct;
  const poly = segment.polygonPx ?? segment.polygon_px ?? null;
  return poly ? polygonCentroid(poly) : null;
}

function polygonCentroid(poly: PxPoint[]): PxPoint | null {
  if (!poly.length) return null;
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of poly) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x; sy += y; n++;
  }
  return n ? [sx / n, sy / n] : null;
}

function unavailable(facetId: string | number, reason: string): SolarPitchLookupResult {
  return {
    facet_id: facetId,
    status: "unavailable",
    pitch_degrees: null,
    pitch_rise_over_12: null,
    azimuth_degrees: null,
    solar_segment_id: null,
    confidence: 0,
    match_reason: reason,
    distance_px: null,
    azimuth_delta_deg: null,
    metadata: { source: "solar_roofSegmentStats", reason },
  };
}

function distance(a: PxPoint, b: PxPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function circularDeltaDeg(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b)) % 360;
  return d > 180 ? 360 - d : d;
}

function normalizeDeg(v: number): number {
  const n = v % 360;
  return n < 0 ? n + 360 : n;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number | null | undefined, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}
