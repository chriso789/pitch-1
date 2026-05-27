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

  const frameMismatchRaw = g.overlay_transform?.frame_mismatch ??
    g.overlay_debug?.frame_mismatch ??
    g.frame_mismatch ??
    reg.frame_mismatch;
  const frame_mismatch_ok = frameMismatchRaw === "ok" ||
    g.frame_mismatch_ok === true;

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
    target_mask_overlap,
    confirmed_roof_center_lat_lng,
    confirmed_roof_center_px,
    dsm_size_px,
  };
}

export function isDerivedBoundsAllowed(inp: DerivedBoundsGateInputs): boolean {
  return Boolean(
    inp.dsm_loaded &&
      inp.raster_bounds_lat_lng &&
      inp.raster_size_px &&
      isNum(inp.raster_meters_per_pixel ?? NaN) &&
      inp.frame_mismatch_ok &&
      isNum(inp.target_mask_overlap ?? NaN) &&
      (inp.target_mask_overlap as number) >= 0.9,
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
