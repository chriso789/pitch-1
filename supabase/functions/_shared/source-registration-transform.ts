// ============================================================================
// Source Registration Transform Builder v1
// ----------------------------------------------------------------------------
// Pure Web-Mercator math for building the geo/raster/DSM coordinate transform
// package that Registration Gate v2.3 consumes. No I/O.
//
// The Fonsica failure mode this fixes: the pipeline was calling the gate with
// `confirmed_roof_center_px = null`, `geo_to_raster_transform = null`,
// `raster_bounds_lat_lng = null`, etc. because the client never sent pixel
// coords and earlier code didn't derive them. This module derives every field
// from the raw inputs (static map center/zoom/size/scale and DSM tile bounds)
// so the gate has real evidence to evaluate.
//
// Coordinate spaces:
//   geo_lat_lng     → WGS84 lat/lng
//   raster_px       → Google Static Map raster pixels (with scale applied)
//   dsm_px          → DSM tile pixels (Solar Data Layers GeoTIFF)
// ============================================================================

export const SOURCE_REGISTRATION_TRANSFORM_VERSION =
  "source-registration-transform-v1";

/** Operator-facing policy tag for the dsm-registration-transform-v1 surface. */
export const DSM_TRANSFORM_POLICY_VERSION = "dsm-registration-transform-v1";

export type GeoToDsmTransformSource =
  | "composed_from_dsm_tile_bounds_and_size"
  | "missing";
export type DsmToRasterTransformSource =
  | "composed_geo_to_dsm_then_geo_to_raster"
  | "missing";
export type ConfirmedRoofCenterDsmPxSource =
  | "geo_projected_via_geo_to_dsm"
  | "raster_center_projected_into_dsm"
  | "missing";

export type LatLng = { lat: number; lng: number };
export type Bounds = { sw: LatLng; ne: LatLng };
export type SizePx = { width: number; height: number };
export type Px = [number, number];

export interface RasterTransform {
  kind: "web_mercator_static_map";
  bounds: Bounds;
  size_px: SizePx;
  zoom: number;
  meters_per_pixel: number;
}

export interface DsmTransform {
  kind: "dsm_tile_linear";
  bounds: Bounds;
  size_px: SizePx;
  meters_per_pixel: number | null;
}

export interface DsmToRasterTransform {
  kind: "dsm_to_raster_linear";
  dsm_bounds: Bounds;
  raster_bounds: Bounds;
  dsm_size_px: SizePx;
  raster_size_px: SizePx;
  bounds_overlap: boolean;
}

// ---------------------------------------------------------------------------
// Web Mercator helpers (pure)
// ---------------------------------------------------------------------------

const EARTH_CIRC_M = 40075016.686; // metres at equator

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isFiniteLatLng(v: unknown): v is LatLng {
  return (
    !!v &&
    typeof v === "object" &&
    isFiniteNumber((v as any).lat) &&
    isFiniteNumber((v as any).lng) &&
    Math.abs((v as any).lat) <= 90 &&
    Math.abs((v as any).lng) <= 180
  );
}

/** Web-Mercator ground resolution (metres per logical pixel at zoom z). */
export function metersPerLogicalPixel(lat: number, zoom: number): number {
  return (Math.cos((lat * Math.PI) / 180) * EARTH_CIRC_M) /
    Math.pow(2, zoom + 8);
}

export function pointInBounds(p: LatLng, b: Bounds): boolean {
  return p.lat >= b.sw.lat && p.lat <= b.ne.lat &&
    p.lng >= b.sw.lng && p.lng <= b.ne.lng;
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return !(
    a.ne.lat < b.sw.lat || a.sw.lat > b.ne.lat ||
    a.ne.lng < b.sw.lng || a.sw.lng > b.ne.lng
  );
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Compute the geographic bounds covered by a Google Static Map tile centered at
 * `centerLatLng` with the given zoom, logical size (CSS px), and scale factor.
 * Uses Web-Mercator math at the centre latitude; accurate to within sub-pixel
 * for tiles up to ~1000 px wide at typical residential zooms (19–21).
 */
export function buildRasterBoundsFromStaticMap(args: {
  centerLatLng: LatLng;
  zoom: number;
  sizePx: SizePx; // logical CSS size (e.g. 640x640)
  scale: number; // 1 or 2
}): { bounds: Bounds; rasterSizePx: SizePx; metersPerPixel: number } | null {
  if (!isFiniteLatLng(args.centerLatLng)) return null;
  if (!isFiniteNumber(args.zoom) || !isFiniteNumber(args.scale)) return null;
  if (!isFiniteNumber(args.sizePx.width) || !isFiniteNumber(args.sizePx.height)) return null;
  const mppLogical = metersPerLogicalPixel(args.centerLatLng.lat, args.zoom);
  if (!isFiniteNumber(mppLogical) || mppLogical <= 0) return null;
  const halfWidthM = (args.sizePx.width / 2) * mppLogical;
  const halfHeightM = (args.sizePx.height / 2) * mppLogical;
  // Approximate metres-per-degree at this latitude.
  const metresPerDegLat = 111320;
  const metresPerDegLng = 111320 *
    Math.cos((args.centerLatLng.lat * Math.PI) / 180);
  if (metresPerDegLng <= 0) return null;
  const dLat = halfHeightM / metresPerDegLat;
  const dLng = halfWidthM / metresPerDegLng;
  const bounds: Bounds = {
    sw: {
      lat: args.centerLatLng.lat - dLat,
      lng: args.centerLatLng.lng - dLng,
    },
    ne: {
      lat: args.centerLatLng.lat + dLat,
      lng: args.centerLatLng.lng + dLng,
    },
  };
  const rasterSizePx: SizePx = {
    width: args.sizePx.width * args.scale,
    height: args.sizePx.height * args.scale,
  };
  const metersPerPixel = mppLogical / args.scale;
  return { bounds, rasterSizePx, metersPerPixel };
}

export function buildGeoToRasterTransform(args: {
  rasterBoundsLatLng: Bounds;
  rasterSizePx: SizePx;
  zoom: number;
  metersPerPixel: number;
}): RasterTransform | null {
  if (!args.rasterBoundsLatLng || !args.rasterSizePx) return null;
  if (!isFiniteNumber(args.zoom) || !isFiniteNumber(args.metersPerPixel)) return null;
  return {
    kind: "web_mercator_static_map",
    bounds: args.rasterBoundsLatLng,
    size_px: args.rasterSizePx,
    zoom: args.zoom,
    meters_per_pixel: args.metersPerPixel,
  };
}

export function buildGeoToDsmTransform(args: {
  dsmTileBoundsLatLng: Bounds;
  dsmSizePx: SizePx;
  metersPerPixel?: number | null;
}): DsmTransform | null {
  if (!args.dsmTileBoundsLatLng || !args.dsmSizePx) return null;
  if (!isFiniteNumber(args.dsmSizePx.width) || !isFiniteNumber(args.dsmSizePx.height)) return null;
  return {
    kind: "dsm_tile_linear",
    bounds: args.dsmTileBoundsLatLng,
    size_px: args.dsmSizePx,
    meters_per_pixel: isFiniteNumber(args.metersPerPixel) ? args.metersPerPixel : null,
  };
}

export function buildDsmToRasterTransform(args: {
  dsmTileBoundsLatLng: Bounds;
  rasterBoundsLatLng: Bounds;
  dsmSizePx: SizePx;
  rasterSizePx: SizePx;
}): DsmToRasterTransform | null {
  if (!args.dsmTileBoundsLatLng || !args.rasterBoundsLatLng) return null;
  if (!args.dsmSizePx || !args.rasterSizePx) return null;
  const overlap = boundsOverlap(args.dsmTileBoundsLatLng, args.rasterBoundsLatLng);
  if (!overlap) return null;
  return {
    kind: "dsm_to_raster_linear",
    dsm_bounds: args.dsmTileBoundsLatLng,
    raster_bounds: args.rasterBoundsLatLng,
    dsm_size_px: args.dsmSizePx,
    raster_size_px: args.rasterSizePx,
    bounds_overlap: true,
  };
}

/** Project a lat/lng into raster pixels using a linear lat/lng→bounds map. */
export function projectLatLngToRasterPx(
  latLng: LatLng,
  transform: RasterTransform | null | undefined,
): Px | null {
  if (!transform || !isFiniteLatLng(latLng)) return null;
  const b = transform.bounds;
  const w = transform.size_px.width;
  const h = transform.size_px.height;
  const dLng = b.ne.lng - b.sw.lng;
  const dLat = b.ne.lat - b.sw.lat;
  if (dLng <= 0 || dLat <= 0) return null;
  const x = ((latLng.lng - b.sw.lng) / dLng) * w;
  // Pixel y grows downward, latitude grows upward.
  const y = ((b.ne.lat - latLng.lat) / dLat) * h;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return [x, y];
}

export function projectLatLngToDsmPx(
  latLng: LatLng,
  transform: DsmTransform | null | undefined,
): Px | null {
  if (!transform || !isFiniteLatLng(latLng)) return null;
  const b = transform.bounds;
  const w = transform.size_px.width;
  const h = transform.size_px.height;
  const dLng = b.ne.lng - b.sw.lng;
  const dLat = b.ne.lat - b.sw.lat;
  if (dLng <= 0 || dLat <= 0) return null;
  const x = ((latLng.lng - b.sw.lng) / dLng) * w;
  const y = ((b.ne.lat - latLng.lat) / dLat) * h;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return [x, y];
}

// ---------------------------------------------------------------------------
// Package
// ---------------------------------------------------------------------------

export interface RegistrationTransformPackageInput {
  confirmed_roof_center_lat_lng: LatLng | null;
  // Static map (raster) inputs.
  static_map_center_lat_lng?: LatLng | null;
  zoom?: number | null;
  size?: SizePx | null; // logical CSS size
  scale?: number | null;
  // Optional DSM inputs (added once DSM has been fetched).
  dsm_tile_bounds_lat_lng?: Bounds | null;
  dsm_size_px?: SizePx | null;
  dsm_meters_per_pixel?: number | null;
}

export interface RegistrationTransformPackage {
  version: typeof SOURCE_REGISTRATION_TRANSFORM_VERSION;
  static_map_center_lat_lng: LatLng | null;
  zoom: number | null;
  size: SizePx | null;
  scale: number | null;
  raster_size_px: SizePx | null;
  raster_bounds_lat_lng: Bounds | null;
  geo_to_raster_transform: RasterTransform | null;
  confirmed_roof_center_px: Px | null;
  raster_bounds_contain_confirmed_center: boolean;
  dsm_tile_bounds_lat_lng: Bounds | null;
  dsm_size_px: SizePx | null;
  geo_to_dsm_transform: DsmTransform | null;
  dsm_to_raster_transform: DsmToRasterTransform | null;
  confirmed_roof_center_dsm_px: Px | null;
  dsm_tile_bounds_contain_confirmed_center: boolean;
  geo_to_dsm_px_success: boolean;
  dsm_pixel_transform_valid: boolean;
  coordinate_space_input: "geo_lat_lng";
  coordinate_space_candidate: "raster_px";
  coordinate_space_solver: "dsm_px";
  coordinate_space_renderer: "raster_px";
  transform_package_valid: boolean;
  missing_required_fields: string[];
}

export function buildRegistrationTransformPackage(
  input: RegistrationTransformPackageInput,
): RegistrationTransformPackage {
  const missing: string[] = [];
  const confirmed = isFiniteLatLng(input.confirmed_roof_center_lat_lng)
    ? input.confirmed_roof_center_lat_lng
    : null;
  if (!confirmed) missing.push("confirmed_roof_center_lat_lng");

  // ── Raster (static map) ──
  const staticCenter = isFiniteLatLng(input.static_map_center_lat_lng)
    ? input.static_map_center_lat_lng
    : confirmed;
  let rasterBuilt:
    | { bounds: Bounds; rasterSizePx: SizePx; metersPerPixel: number }
    | null = null;
  if (
    staticCenter && isFiniteNumber(input.zoom) && input.size &&
    isFiniteNumber(input.scale)
  ) {
    rasterBuilt = buildRasterBoundsFromStaticMap({
      centerLatLng: staticCenter,
      zoom: input.zoom,
      sizePx: input.size,
      scale: input.scale,
    });
  }
  if (!rasterBuilt) {
    missing.push("raster_bounds_lat_lng");
    if (input.zoom == null) missing.push("zoom");
    if (input.size == null) missing.push("size");
    if (input.scale == null) missing.push("scale");
  }
  const rasterBounds = rasterBuilt?.bounds ?? null;
  const rasterSizePx = rasterBuilt?.rasterSizePx ?? null;
  const geoToRasterTransform = (rasterBounds && rasterSizePx && rasterBuilt)
    ? buildGeoToRasterTransform({
      rasterBoundsLatLng: rasterBounds,
      rasterSizePx,
      zoom: input.zoom!,
      metersPerPixel: rasterBuilt.metersPerPixel,
    })
    : null;
  if (!geoToRasterTransform) missing.push("geo_to_raster_transform");

  const confirmedRoofCenterPx = (confirmed && geoToRasterTransform)
    ? projectLatLngToRasterPx(confirmed, geoToRasterTransform)
    : null;
  if (!confirmedRoofCenterPx) missing.push("confirmed_roof_center_px");
  const rasterContainsConfirmed = !!(rasterBounds && confirmed &&
    pointInBounds(confirmed, rasterBounds));
  if (rasterBounds && !rasterContainsConfirmed) {
    missing.push("raster_bounds_contain_confirmed_center");
  }

  // ── DSM (optional) ──
  const dsmBounds = (input.dsm_tile_bounds_lat_lng &&
      isFiniteLatLng(input.dsm_tile_bounds_lat_lng.sw) &&
      isFiniteLatLng(input.dsm_tile_bounds_lat_lng.ne))
    ? input.dsm_tile_bounds_lat_lng
    : null;
  const dsmSizePx = (input.dsm_size_px &&
      isFiniteNumber(input.dsm_size_px.width) &&
      isFiniteNumber(input.dsm_size_px.height))
    ? input.dsm_size_px
    : null;
  const geoToDsmTransform = (dsmBounds && dsmSizePx)
    ? buildGeoToDsmTransform({
      dsmTileBoundsLatLng: dsmBounds,
      dsmSizePx,
      metersPerPixel: input.dsm_meters_per_pixel ?? null,
    })
    : null;
  if (!geoToDsmTransform) missing.push("geo_to_dsm_transform");
  if (!dsmBounds) missing.push("dsm_tile_bounds_lat_lng");

  const dsmToRasterTransform =
    (dsmBounds && rasterBounds && dsmSizePx && rasterSizePx)
      ? buildDsmToRasterTransform({
        dsmTileBoundsLatLng: dsmBounds,
        rasterBoundsLatLng: rasterBounds,
        dsmSizePx,
        rasterSizePx,
      })
      : null;
  if (!dsmToRasterTransform) missing.push("dsm_to_raster_transform");

  const confirmedRoofCenterDsmPx = (confirmed && geoToDsmTransform)
    ? projectLatLngToDsmPx(confirmed, geoToDsmTransform)
    : null;
  if (!confirmedRoofCenterDsmPx) missing.push("confirmed_roof_center_dsm_px");
  const dsmContainsConfirmed = !!(dsmBounds && confirmed &&
    pointInBounds(confirmed, dsmBounds));

  // Truth-from-math booleans.
  const geo_to_dsm_px_success = !!(geoToDsmTransform &&
    confirmedRoofCenterDsmPx && dsmContainsConfirmed);
  const dsm_pixel_transform_valid = !!(dsmToRasterTransform &&
    dsmToRasterTransform.bounds_overlap);

  const transform_package_valid = missing.length === 0 &&
    geo_to_dsm_px_success && dsm_pixel_transform_valid &&
    rasterContainsConfirmed;

  return {
    version: SOURCE_REGISTRATION_TRANSFORM_VERSION,
    static_map_center_lat_lng: staticCenter,
    zoom: isFiniteNumber(input.zoom) ? input.zoom : null,
    size: input.size ?? null,
    scale: isFiniteNumber(input.scale) ? input.scale : null,
    raster_size_px: rasterSizePx,
    raster_bounds_lat_lng: rasterBounds,
    geo_to_raster_transform: geoToRasterTransform,
    confirmed_roof_center_px: confirmedRoofCenterPx,
    raster_bounds_contain_confirmed_center: rasterContainsConfirmed,
    dsm_tile_bounds_lat_lng: dsmBounds,
    dsm_size_px: dsmSizePx,
    geo_to_dsm_transform: geoToDsmTransform,
    dsm_to_raster_transform: dsmToRasterTransform,
    confirmed_roof_center_dsm_px: confirmedRoofCenterDsmPx,
    dsm_tile_bounds_contain_confirmed_center: dsmContainsConfirmed,
    geo_to_dsm_px_success,
    dsm_pixel_transform_valid,
    coordinate_space_input: "geo_lat_lng",
    coordinate_space_candidate: "raster_px",
    coordinate_space_solver: "dsm_px",
    coordinate_space_renderer: "raster_px",
    transform_package_valid,
    missing_required_fields: missing,
  };
}

export function validateRegistrationTransformPackage(
  pkg: RegistrationTransformPackage | null | undefined,
): { valid: boolean; missing: string[]; reasons: string[] } {
  if (!pkg) {
    return {
      valid: false,
      missing: ["transform_package"],
      reasons: ["transform_package_absent"],
    };
  }
  const reasons: string[] = [];
  if (!pkg.transform_package_valid) reasons.push("transform_package_invalid");
  if (!pkg.geo_to_dsm_px_success) reasons.push("geo_to_dsm_projection_failed");
  if (!pkg.dsm_pixel_transform_valid) reasons.push("dsm_to_raster_invalid");
  if (!pkg.raster_bounds_contain_confirmed_center) {
    reasons.push("confirmed_center_outside_raster");
  }
  return {
    valid: pkg.transform_package_valid,
    missing: pkg.missing_required_fields,
    reasons,
  };
}
