// Patent-aligned Layer Model.
// Rule 2: No internal topology runs until a valid Layer-1 outermost roof
// perimeter exists. This module defines the contract and a single
// classification helper that any code path can use.

export const FORBIDDEN_LAYER1_SOURCES = [
  'solar_segment_union',
  'solar_segment_hull',
  'solar_segment_bbox',
  'parcel_boundary',
  'global_mask_bbox',
  'interior_plane_contour',
  'google_solar_bbox',
  'osm_parcel',
] as const;

export const ALLOWED_LAYER1_SOURCES = [
  'eave',
  'rake',
  'roof_free_edge_with_gutter',
  'roof_free_edge_without_gutter',
  'true_outer_roof_perimeter',
  'dsm_perimeter_trace',
  'mask_contour_target', // target-mask isolated contour, not global mask
  'user_traced_perimeter',
  'vendor_verified_perimeter',
] as const;

export type Layer1Source =
  | typeof ALLOWED_LAYER1_SOURCES[number]
  | typeof FORBIDDEN_LAYER1_SOURCES[number]
  | 'unknown';

export interface Layer1Perimeter {
  source: Layer1Source;
  geometry_px: Array<{ x: number; y: number }>;
  geometry_geo?: Array<{ lat: number; lng: number }> | null;
  confidence: number;
  closed: boolean;
  self_intersections: number;
  forbidden_source_rejected_reasons: string[];
  is_valid: boolean;
}

export interface Layer1Validation {
  is_valid: boolean;
  reasons: string[];
}

/**
 * Classify and validate a candidate Layer-1 perimeter.
 * Returns is_valid=false with concrete reasons if the source is forbidden,
 * the ring isn't closed, or self-intersects.
 */
export function classifyLayer1(
  source: string | null | undefined,
  geometry_px: Array<{ x: number; y: number }>,
  opts: {
    geometry_geo?: Array<{ lat: number; lng: number }> | null;
    confidence?: number;
  } = {},
): Layer1Perimeter {
  const reasons: string[] = [];
  const normalizedSource = (source ?? 'unknown') as Layer1Source;

  if ((FORBIDDEN_LAYER1_SOURCES as readonly string[]).includes(normalizedSource)) {
    reasons.push(`forbidden_source:${normalizedSource}`);
  }

  const closed =
    Array.isArray(geometry_px) &&
    geometry_px.length >= 4 &&
    geometry_px[0].x === geometry_px[geometry_px.length - 1].x &&
    geometry_px[0].y === geometry_px[geometry_px.length - 1].y;

  const selfIntersections = countSelfIntersections(geometry_px);
  if (selfIntersections > 0) reasons.push(`self_intersections:${selfIntersections}`);
  if (geometry_px.length < 3) reasons.push('insufficient_vertices');

  const allowedSource = (ALLOWED_LAYER1_SOURCES as readonly string[]).includes(normalizedSource);
  if (!allowedSource && !reasons.some((r) => r.startsWith('forbidden_source'))) {
    reasons.push(`unknown_source:${normalizedSource}`);
  }

  return {
    source: normalizedSource,
    geometry_px,
    geometry_geo: opts.geometry_geo ?? null,
    confidence: opts.confidence ?? 0,
    closed,
    self_intersections: selfIntersections,
    forbidden_source_rejected_reasons: reasons,
    is_valid: reasons.length === 0 && geometry_px.length >= 3,
  };
}

/**
 * Hard guard. Throws if Layer 1 is invalid. Use this at the entry of any
 * topology/solver call.
 */
export function requireLayer1(layer1: Layer1Perimeter | null | undefined): asserts layer1 is Layer1Perimeter {
  if (!layer1 || !layer1.is_valid) {
    const reasons = layer1?.forbidden_source_rejected_reasons.join(',') ?? 'no_layer1';
    throw new Error(`ai_failed_layer1_invalid:${reasons}`);
  }
}

function countSelfIntersections(pts: Array<{ x: number; y: number }>): number {
  if (!Array.isArray(pts) || pts.length < 4) return 0;
  let count = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 2; j < pts.length - 1; j++) {
      if (i === 0 && j === pts.length - 2) continue; // shared endpoint
      if (segmentsIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) count++;
    }
  }
  return count;
}

function segmentsIntersect(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number },
): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
