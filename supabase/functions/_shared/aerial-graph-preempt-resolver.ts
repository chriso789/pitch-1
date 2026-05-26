// aerial-graph-preempt-resolver.ts
//
// Fallback resolver used at CPU-preempt sites in `start-ai-measurement` to
// guarantee the aerial candidate graph builder always receives a usable
// registration package — even when the early hoist at the top of
// `runMeasurement` failed silently (try/catch) and left
// `hoistedTransformPackage` null.
//
// Contract:
//   • Pure: no I/O, never throws.
//   • Idempotent: returns the hoisted package unchanged if it's non-null.
//   • Belt-and-suspenders: rebuilds a DSM-independent registration package
//     from the same raster acquisition inputs the early hoist used.
//
// Used by:
//   - `pre_phase3_5_preempt` site
//   - `phase3_5_perimeter_refinement` preempt site
//   - `autonomous_topology_solver` preempt site
//   - regression test fixtures

import { buildRegistrationTransformPackage } from "./source-registration-transform.ts";

export interface PreemptRegistrationResolution {
  transformPackage: any;
  rasterBoundsLatLng: any;
  geoToRasterTransform: any;
  confirmedRoofCenterPx: any;
  source:
    | "hoisted"
    | "rebuilt_from_input"
    | "rebuild_failed"
    | "unavailable";
  rebuild_error?: string | null;
}

export function resolveRegistrationForPreempt(args: {
  input: any;
  coords: { lat: number; lng: number };
  hoistedTransformPackage: any;
  hoistedRasterBoundsLatLng: any;
  hoistedGeoToRasterTransform: any;
  hoistedConfirmedRoofCenterPx: any;
}): PreemptRegistrationResolution {
  // 1. If the early hoist already produced a package, use it.
  if (args.hoistedTransformPackage != null) {
    return {
      transformPackage: args.hoistedTransformPackage,
      rasterBoundsLatLng: args.hoistedRasterBoundsLatLng ??
        (args.hoistedTransformPackage as any)?.raster_bounds_lat_lng ?? null,
      geoToRasterTransform: args.hoistedGeoToRasterTransform ??
        (args.hoistedTransformPackage as any)?.geo_to_raster_transform ?? null,
      confirmedRoofCenterPx: args.hoistedConfirmedRoofCenterPx ??
        (args.hoistedTransformPackage as any)?.confirmed_roof_center_px ?? null,
      source: "hoisted",
    };
  }

  // 2. Rebuild from raster acquisition inputs (DSM-independent).
  try {
    const input = args.input ?? {};
    const confirmedLatLng = input.confirmed_roof_center_lat != null &&
        input.confirmed_roof_center_lng != null
      ? {
        lat: Number(input.confirmed_roof_center_lat),
        lng: Number(input.confirmed_roof_center_lng),
      }
      : { lat: args.coords.lat, lng: args.coords.lng };

    const pkg = buildRegistrationTransformPackage({
      confirmed_roof_center_lat_lng: confirmedLatLng,
      static_map_center_lat_lng: { lat: args.coords.lat, lng: args.coords.lng },
      zoom: Number.isFinite(Number(input.zoom)) ? Number(input.zoom) : 19,
      size: {
        width: Number(input.logical_image_width || 640),
        height: Number(input.logical_image_height || 640),
      },
      scale: Number(input.raster_scale || 2),
      dsm_tile_bounds_lat_lng: null,
      dsm_size_px: null,
      dsm_meters_per_pixel: null,
    });

    if (pkg == null) {
      return {
        transformPackage: null,
        rasterBoundsLatLng: null,
        geoToRasterTransform: null,
        confirmedRoofCenterPx: null,
        source: "unavailable",
      };
    }

    return {
      transformPackage: pkg,
      rasterBoundsLatLng: (pkg as any)?.raster_bounds_lat_lng ?? null,
      geoToRasterTransform: (pkg as any)?.geo_to_raster_transform ?? null,
      confirmedRoofCenterPx: (pkg as any)?.confirmed_roof_center_px ?? null,
      source: "rebuilt_from_input",
    };
  } catch (e) {
    return {
      transformPackage: null,
      rasterBoundsLatLng: null,
      geoToRasterTransform: null,
      confirmedRoofCenterPx: null,
      source: "rebuild_failed",
      rebuild_error: (e as Error)?.message ?? String(e),
    };
  }
}

/**
 * Detects Fonsica-shaped aerial inputs — i.e., the bag has every input
 * required to execute the aerial candidate graph builder. If this returns
 * true AND the persisted graph reports `raster_transform_unavailable`,
 * something is internally inconsistent and we flag it for debugging.
 */
export function isFonsicaShapedAerialInput(args: {
  geoToRasterTransform: any;
  rasterBoundsLatLng: any;
  perimeterRingPx: any;
  eaveEdges: any;
  perimeterEdges: any;
}): boolean {
  const hasTransform = args.geoToRasterTransform != null;
  const hasBounds = args.rasterBoundsLatLng != null;
  const hasRingPx = Array.isArray(args.perimeterRingPx) &&
    args.perimeterRingPx.length >= 3;
  const eaves = Array.isArray(args.eaveEdges) ? args.eaveEdges.length : 0;
  const perim = Array.isArray(args.perimeterEdges)
    ? args.perimeterEdges.length
    : 0;
  return hasTransform && hasBounds && hasRingPx && (eaves > 0 || perim > 0);
}
