// ============================================================================
// dsm-registration-derived-bounds-v1 (runtime helper)
// ----------------------------------------------------------------------------
// Pure helpers used by `start-ai-measurement` to:
//   1) gather derived-bounds gate inputs from many possible runtime payload
//      locations (so the gate doesn't silently fail because a field moved),
//   2) compute the raster→geo→DSM→raster roundtrip error in px,
//   3) build the v1 diagnostic surface persisted on the registration block.
//
// These are split out so they can be regression-tested without dragging the
// 16k-line `start-ai-measurement/index.ts` into the test harness.
// ============================================================================

import type {
  Bounds,
  DsmToRasterTransform,
  DsmTransform,
  LatLng,
  Px,
  RasterTransform,
  SizePx,
} from "./source-registration-transform.ts";
import { resolveFrameMismatch } from "./resolveFrameMismatch.ts";

export const DSM_DERIVED_BOUNDS_RUNTIME_VERSION =
  "dsm-registration-derived-bounds-v1";

/** Roundtrip error threshold (raster_px) for derived-bounds acceptance. */
export const DSM_RASTER_ROUNDTRIP_THRESHOLD_PX = 8;

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const firstFinite = (...vals: unknown[]): number | null => {
  for (const v of vals) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const firstTruthy = <T>(...vals: (T | null | undefined)[]): T | null => {
  for (const v of vals) if (v != null) return v as T;
  return null;
};

// ---------------------------------------------------------------------------
// Gate input lookup (reads runtime payload from every known location)
// ---------------------------------------------------------------------------

export interface DerivedBoundsGateInputs {
  dsm_loaded: boolean;
  mask_loaded: boolean;
  raster_bounds_lat_lng: Bounds | null;
  raster_size_px: SizePx | null;
  raster_meters_per_pixel: number | null;
  geo_to_raster_transform: RasterTransform | null;
  frame_mismatch_ok: boolean;
  /** Path/source label returned by resolveFrameMismatch. */
  frame_mismatch_source: string | null;
  /** Raw frame_mismatch string when an explicit source was found. */
  frame_mismatch_raw: string | null;
  /** Evidence snapshot used when frame_mismatch was inferred. */
  raster_registration_evidence: Record<string, unknown>;
  target_mask_overlap: number | null;
  confirmed_roof_center_lat_lng: LatLng | null;
  confirmed_roof_center_px: Px | null;
  dsm_size_px: SizePx | null;
}

export function gatherDerivedBoundsGateInputs(
  geometry: any,
  registration: any,
): DerivedBoundsGateInputs {
  const g = geometry ?? {};
  const reg = registration ?? {};
  const regTp = reg.transform_package ?? {};
  const gateTp = g.registration_gate?.transform_package ?? {};
  const regGate = g.registration_gate ?? {};
  const regOnG = g.registration ?? {};
  const regOnGTp = regOnG.transform_package ?? {};

  const dsmCoordinateMatchDebug = g.dsm_coordinate_match ??
    g.source_acquisition_debug?.dsm_coordinate_match ??
    null;

  const dsm_loaded = Boolean(
    g.dsm_loaded ??
      g.source_acquisition_debug?.dsm_loaded ??
      reg.dsm_stage_attempted ??
      dsmCoordinateMatchDebug?.dsm_bbox != null,
  );
  const mask_loaded = Boolean(
    g.mask_loaded ?? g.source_acquisition_debug?.mask_loaded,
  );

  const raster_bounds_lat_lng = firstTruthy<Bounds>(
    reg.raster_bounds_lat_lng,
    regTp.raster_bounds_lat_lng,
    g.raster_bounds_lat_lng,
    regOnG.raster_bounds_lat_lng,
    regOnGTp.raster_bounds_lat_lng,
    regGate.raster_bounds_lat_lng,
    gateTp.raster_bounds_lat_lng,
  );

  const raster_size_px = firstTruthy<SizePx>(
    reg.raster_size_px,
    regTp.raster_size_px,
    g.raster_size_px,
    regOnG.raster_size_px,
    regOnGTp.raster_size_px,
    regGate.raster_size_px,
    gateTp.raster_size_px,
  );

  const raster_meters_per_pixel = firstFinite(
    g.meters_per_pixel,
    g.raster_meters_per_pixel,
    reg.meters_per_pixel,
    reg.raster_meters_per_pixel,
    regTp.geo_to_raster_transform?.meters_per_pixel,
    reg.geo_to_raster_transform?.meters_per_pixel,
    regOnGTp.geo_to_raster_transform?.meters_per_pixel,
    gateTp.geo_to_raster_transform?.meters_per_pixel,
  );

  const geo_to_raster_transform = firstTruthy<RasterTransform>(
    reg.geo_to_raster_transform,
    regTp.geo_to_raster_transform,
    g.geo_to_raster_transform,
    regOnG.geo_to_raster_transform,
    regOnGTp.geo_to_raster_transform,
    regGate.geo_to_raster_transform,
    gateTp.geo_to_raster_transform,
  );

  // Unified frame-mismatch resolution — mirrors the early-DSM gate so a single
  // source of truth decides whether the overlay frame is OK. Reads the live
  // overlay_transform + registration.transform_package paths (raster_px on
  // both ends, source raster size present, target_mask_overlap >= 0.9) before
  // falling back to the legacy dsmCoordinateMatchDebug bag.
  const dsmCoordinateMatchDebugForFrame = g.dsm_coordinate_match ??
    g.source_acquisition_debug?.dsm_coordinate_match ?? null;
  const geometryViewForFrame = {
    ...g,
    registration: {
      ...(g.registration ?? {}),
      transform_package: {
        ...(g.registration?.transform_package ?? {}),
        ...regTp,
        coordinate_space_candidate:
          g.registration?.transform_package?.coordinate_space_candidate ??
            regTp?.coordinate_space_candidate ??
            g.coordinate_space_candidate,
        coordinate_space_renderer:
          g.registration?.transform_package?.coordinate_space_renderer ??
            regTp?.coordinate_space_renderer ??
            g.coordinate_space_renderer,
        raster_size_px: g.registration?.transform_package?.raster_size_px ??
          regTp?.raster_size_px ?? raster_size_px,
        raster_bounds_contain_confirmed_center:
          g.registration?.transform_package
            ?.raster_bounds_contain_confirmed_center ??
            regTp?.raster_bounds_contain_confirmed_center,
      },
    },
  };
  const frameResolution = resolveFrameMismatch(
    geometryViewForFrame,
    dsmCoordinateMatchDebugForFrame,
  );
  const frame_mismatch_ok = frameResolution.frame_mismatch_ok ||
    g.frame_mismatch_ok === true;
  const frame_mismatch_source = frameResolution.frame_mismatch_source;
  const frame_mismatch_raw = frameResolution.frame_mismatch_raw;
  const raster_registration_evidence =
    frameResolution.raster_registration_evidence;

  const target_mask_overlap = firstFinite(
    g.target_mask_overlap_with_perimeter,
    g.target_mask_isolation?.target_mask_overlap_with_perimeter,
    g.perimeter_phase0?.target_mask_overlap_with_perimeter,
    g.aerial_candidate_roof_graph?.target_mask_overlap_with_perimeter,
    g.dsm_planar_graph_debug?.aerial_candidate_roof_graph
      ?.target_mask_overlap_with_perimeter,
    reg.target_mask_overlap_with_perimeter,
  );

  const confirmed_roof_center_lat_lng = firstTruthy<LatLng>(
    reg.confirmed_roof_center_lat_lng,
    g.confirmed_roof_center_lat_lng,
  );

  const confirmed_roof_center_px = firstTruthy<Px>(
    reg.confirmed_roof_center_px as any,
    regTp.confirmed_roof_center_px as any,
    g.confirmed_roof_center_px as any,
  );

  const dsm_size_px = firstTruthy<SizePx>(
    reg.dsm_size_px,
    regTp.dsm_size_px,
    g.effective_dsm
      ? isNum(g.effective_dsm.width) && isNum(g.effective_dsm.height)
        ? { width: g.effective_dsm.width, height: g.effective_dsm.height }
        : null
      : null,
  );

  return {
    dsm_loaded,
    mask_loaded,
    raster_bounds_lat_lng,
    raster_size_px,
    raster_meters_per_pixel,
    geo_to_raster_transform,
    frame_mismatch_ok,
    frame_mismatch_source,
    frame_mismatch_raw,
    raster_registration_evidence,
    target_mask_overlap,
    confirmed_roof_center_lat_lng,
    confirmed_roof_center_px,
    dsm_size_px,
  };
}

export function isDerivedBoundsAllowed(inp: DerivedBoundsGateInputs): boolean {
  // DSM bounds are an image-registration fact, not a target-mask-quality fact.
  // A low target-mask overlap should block customer-ready topology later, but it
  // must not relabel an otherwise registered raster as `dsm_bounds_missing`.
  // Fonsica regression: a bad/partial mask produced overlap < 0.9 even though
  // the static raster bounds, size, mpp, and frame registration were valid.
  return Boolean(
    inp.dsm_loaded &&
      inp.raster_bounds_lat_lng &&
      inp.raster_size_px &&
      isNum(inp.raster_meters_per_pixel ?? NaN) &&
      inp.frame_mismatch_ok,
  );
}

// ---------------------------------------------------------------------------
// Raster ⇄ DSM roundtrip
// ---------------------------------------------------------------------------

function rasterPxToLatLng(
  px: Px,
  t: RasterTransform,
): LatLng | null {
  const w = t.size_px?.width;
  const h = t.size_px?.height;
  const b = t.bounds;
  if (!isNum(w) || !isNum(h) || w <= 0 || h <= 0) return null;
  if (!b?.sw || !b?.ne) return null;
  const dLng = b.ne.lng - b.sw.lng;
  const dLat = b.ne.lat - b.sw.lat;
  if (dLng <= 0 || dLat <= 0) return null;
  const lng = b.sw.lng + (px[0] / w) * dLng;
  const lat = b.ne.lat - (px[1] / h) * dLat;
  if (!isNum(lat) || !isNum(lng)) return null;
  return { lat, lng };
}

function latLngToRasterPx(ll: LatLng, t: RasterTransform): Px | null {
  const w = t.size_px?.width;
  const h = t.size_px?.height;
  const b = t.bounds;
  if (!isNum(w) || !isNum(h) || w <= 0 || h <= 0) return null;
  if (!b?.sw || !b?.ne) return null;
  const dLng = b.ne.lng - b.sw.lng;
  const dLat = b.ne.lat - b.sw.lat;
  if (dLng <= 0 || dLat <= 0) return null;
  const x = ((ll.lng - b.sw.lng) / dLng) * w;
  const y = ((b.ne.lat - ll.lat) / dLat) * h;
  if (!isNum(x) || !isNum(y)) return null;
  return [x, y];
}

function latLngToDsmPx(ll: LatLng, t: DsmTransform): Px | null {
  const w = t.size_px?.width;
  const h = t.size_px?.height;
  const b = t.bounds;
  if (!isNum(w) || !isNum(h) || w <= 0 || h <= 0) return null;
  if (!b?.sw || !b?.ne) return null;
  const dLng = b.ne.lng - b.sw.lng;
  const dLat = b.ne.lat - b.sw.lat;
  if (dLng <= 0 || dLat <= 0) return null;
  const x = ((ll.lng - b.sw.lng) / dLng) * w;
  const y = ((b.ne.lat - ll.lat) / dLat) * h;
  if (!isNum(x) || !isNum(y)) return null;
  return [x, y];
}

function dsmPxToRasterPx(
  px: Px,
  t: DsmToRasterTransform,
): Px | null {
  const dsm = t.dsm_size_px;
  const ras = t.raster_size_px;
  if (!dsm || !ras || dsm.width <= 0 || dsm.height <= 0) return null;
  const fx = px[0] / dsm.width;
  const fy = px[1] / dsm.height;
  if (!isNum(fx) || !isNum(fy)) return null;
  return [fx * ras.width, fy * ras.height];
}

/**
 * Compute the raster→geo→DSM→raster roundtrip error (Euclidean px) for a given
 * starting raster pixel. Returns `null` when any required transform is missing
 * or produces a non-finite result.
 */
export function computeRasterDsmRoundtripErrorPx(args: {
  start_raster_px: Px;
  geo_to_raster_transform: RasterTransform | null | undefined;
  geo_to_dsm_transform: DsmTransform | null | undefined;
  dsm_to_raster_transform: DsmToRasterTransform | null | undefined;
}): number | null {
  if (
    !args.geo_to_raster_transform ||
    !args.geo_to_dsm_transform ||
    !args.dsm_to_raster_transform
  ) return null;
  if (!isNum(args.start_raster_px?.[0]) || !isNum(args.start_raster_px?.[1])) {
    return null;
  }
  const ll = rasterPxToLatLng(args.start_raster_px, args.geo_to_raster_transform);
  if (!ll) return null;
  const dsm = latLngToDsmPx(ll, args.geo_to_dsm_transform);
  if (!dsm) return null;
  // Sanity check: round-tripping back via raster→dsm linear map should match.
  const back = dsmPxToRasterPx(dsm, args.dsm_to_raster_transform);
  if (!back) return null;
  const dx = back[0] - args.start_raster_px[0];
  const dy = back[1] - args.start_raster_px[1];
  const err = Math.sqrt(dx * dx + dy * dy);
  return isNum(err) ? err : null;
}

// Also expose lat/lng→raster_px helper for callers that need to verify the
// derived DSM transform projects back through the raster transform cleanly.
export const _testing = {
  latLngToRasterPx,
  rasterPxToLatLng,
  latLngToDsmPx,
  dsmPxToRasterPx,
};

// ============================================================================
// PR A — Outline Unlock: DSM-from-raster fallback
// ----------------------------------------------------------------------------
// When Google Solar returns DSM raster dimensions but no `dsm_tile_bounds_lat_lng`,
// the canonical route currently bails with `dsm_tile_bounds_missing_from_google_solar_metadata`
// and downstream code cannot register DSM ⇄ raster. That blocks topology,
// pitch, manual approval and customer-ready promotion — but it should NOT
// block manual approval of an already-valid aerial perimeter.
//
// This helper produces either:
//   - a derived registration package (DSM bounds copied from the registered
//     raster bounds) when ALL guard conditions pass, OR
//   - an explicit `unavailable_but_aerial_perimeter_editable` status with a
//     machine-readable reason. It NEVER fabricates DSM bounds otherwise.
//
// Caller is responsible for stamping these results onto the registration block
// and routing them through the existing persistence layer. See
// `start-ai-measurement/index.ts` for wiring.
// ============================================================================

export type DsmRegistrationStatus =
  | "derived_from_registered_raster"
  | "unavailable_but_aerial_perimeter_editable";

export interface DeriveDsmRegistrationInput {
  dsm_size_px: SizePx | null;
  raster_bounds_lat_lng: Bounds | null;
  raster_size_px: SizePx | null;
  geo_to_raster_transform: RasterTransform | null;
  selected_candidate_polygon_px: Array<[number, number]> | null;
  candidate_coordinate_space: string | null;
  target_mask_overlap_with_perimeter: number | null;
  confirmed_roof_center_px: Px | null;
}

export interface DeriveDsmRegistrationSuccess {
  status: "derived_from_registered_raster";
  dsm_bounds_source: "derived_from_registered_raster";
  dsm_bounds_derived: true;
  dsm_bounds_confidence: number; // 0.70..0.85
  dsm_registration_source: "derived_registered_raster_fallback";
  geo_to_dsm_transform_source: "derived_from_raster_bounds";
  dsm_to_raster_transform_source: "derived_from_raster_bounds";
  dsm_bounds_lat_lng: Bounds;
  dsm_size_px: SizePx;
}

export interface DeriveDsmRegistrationUnavailable {
  status: "unavailable_but_aerial_perimeter_editable";
  reason: string;
}

export type DeriveDsmRegistrationResult =
  | DeriveDsmRegistrationSuccess
  | DeriveDsmRegistrationUnavailable;

const _polygonContainsPoint = (
  poly: Array<[number, number]>,
  pt: [number, number],
): boolean => {
  // Even-odd ray cast.
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = (yi > pt[1]) !== (yj > pt[1]) &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

const _polygonBbox = (poly: Array<[number, number]>) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

const _pointNearPolygon = (
  poly: Array<[number, number]>,
  pt: [number, number],
  tolPx: number,
): boolean => {
  const bb = _polygonBbox(poly);
  return (
    pt[0] >= bb.minX - tolPx &&
    pt[0] <= bb.maxX + tolPx &&
    pt[1] >= bb.minY - tolPx &&
    pt[1] <= bb.maxY + tolPx
  );
};

/**
 * Try to derive a DSM registration package from registered raster bounds.
 *
 * Guards (ALL required to derive):
 *   1. DSM raster size present (w, h > 0).
 *   2. Raster bounds present and valid (sw < ne).
 *   3. `geo_to_raster_transform` present.
 *   4. Selected candidate polygon present AND in raster_px frame.
 *   5. Confirmed roof center px present AND inside or within 24 px of the
 *      selected raster polygon's bbox.
 *
 * On success, the DSM bounds are copied from the registered raster bounds
 * (the safest possible derivation — both rasters cover the same geographic
 * footprint when the static map and Solar tile are co-registered). Confidence
 * is scaled by target-mask overlap when available. Low overlap is explicitly
 * marked lower-confidence, but still derives bounds so downstream diagnostics
 * report the real blocker (perimeter/topology) instead of stale
 * `dsm_bounds_missing`.
 */
export function tryDeriveDsmRegistrationFromRaster(
  input: DeriveDsmRegistrationInput,
): DeriveDsmRegistrationResult {
  const dsm = input.dsm_size_px;
  if (!dsm || !isNum(dsm.width) || !isNum(dsm.height) || dsm.width <= 0 || dsm.height <= 0) {
    return { status: "unavailable_but_aerial_perimeter_editable", reason: "dsm_size_px_missing" };
  }
  const b = input.raster_bounds_lat_lng;
  if (
    !b || !b.sw || !b.ne ||
    !isNum(b.sw.lat) || !isNum(b.sw.lng) || !isNum(b.ne.lat) || !isNum(b.ne.lng) ||
    b.ne.lng <= b.sw.lng || b.ne.lat <= b.sw.lat
  ) {
    return { status: "unavailable_but_aerial_perimeter_editable", reason: "raster_bounds_invalid" };
  }
  if (!input.geo_to_raster_transform) {
    return { status: "unavailable_but_aerial_perimeter_editable", reason: "geo_to_raster_transform_missing" };
  }
  const poly = input.selected_candidate_polygon_px;
  if (!Array.isArray(poly) || poly.length < 3) {
    return { status: "unavailable_but_aerial_perimeter_editable", reason: "selected_candidate_polygon_missing" };
  }
  if ((input.candidate_coordinate_space ?? "raster_px") !== "raster_px") {
    return { status: "unavailable_but_aerial_perimeter_editable", reason: "candidate_not_in_raster_px" };
  }
  const center = input.confirmed_roof_center_px;
  if (!center || !isNum(center[0]) || !isNum(center[1])) {
    return { status: "unavailable_but_aerial_perimeter_editable", reason: "confirmed_roof_center_px_missing" };
  }
  const centerInside = _polygonContainsPoint(poly as Array<[number, number]>, [center[0], center[1]])
    || _pointNearPolygon(poly as Array<[number, number]>, [center[0], center[1]], 24);
  if (!centerInside) {
    return { status: "unavailable_but_aerial_perimeter_editable", reason: "confirmed_center_outside_candidate_raster" };
  }

  const overlap = input.target_mask_overlap_with_perimeter;
  // All guards passed. Confidence: 0.55 when overlap is missing/low; linearly
  // increases to 0.85 as the target mask agrees. This preserves bounds while
  // still preventing low-overlap DSM topology from being trusted as final.
  const overlapForConfidence = isNum(overlap) ? Math.max(0, Math.min(1, overlap as number)) : 0;
  const conf = Math.max(0.55, Math.min(0.85, 0.55 + overlapForConfidence * 0.30));

  return {
    status: "derived_from_registered_raster",
    dsm_bounds_source: "derived_from_registered_raster",
    dsm_bounds_derived: true,
    dsm_bounds_confidence: Number(conf.toFixed(3)),
    dsm_registration_source: "derived_registered_raster_fallback",
    geo_to_dsm_transform_source: "derived_from_raster_bounds",
    dsm_to_raster_transform_source: "derived_from_raster_bounds",
    dsm_bounds_lat_lng: b,
    dsm_size_px: dsm,
  };
}
