/**
 * Canonical Web-Mercator overlay projection.
 *
 * SINGLE SOURCE OF TRUTH for converting between geographic coordinates
 * (lng/lat) and image pixel coordinates within an aerial raster.
 *
 * Both the browser SVG renderer, the edge-function diagram renderer, and
 * the PDF generator MUST use this helper (or its identical Deno mirror in
 * `supabase/functions/_shared/overlay-projection.ts`).
 *
 * Never inline this math anywhere else — duplication is the #1 cause of
 * the diagram drifting off the satellite image.
 */

export interface OverlayTransform {
  /** Actual decoded raster width in pixels. */
  imageWidth: number;
  /** Actual decoded raster height in pixels. */
  imageHeight: number;
  /** Geographic bounds of the raster: [west, south, east, north]. */
  bounds: [number, number, number, number];
  /** Optional metadata — not used in the math but persisted for audit. */
  center?: { lat: number; lng: number };
  zoom?: number;
  devicePixelRatio?: number;
  projection?: "web_mercator";
}

const mercY = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

export function projectLngLatToImagePx(
  lng: number,
  lat: number,
  t: OverlayTransform,
): [number, number] {
  const [west, south, east, north] = t.bounds;
  const lngRange = Math.max(east - west, 1e-12);
  const top = mercY(north);
  const bottom = mercY(south);
  const yRange = Math.max(top - bottom, 1e-12);

  const x = ((lng - west) / lngRange) * t.imageWidth;
  const y = ((top - mercY(lat)) / yRange) * t.imageHeight;
  return [x, y];
}

export function projectImagePxToLngLat(
  x: number,
  y: number,
  t: OverlayTransform,
): [number, number] {
  const [west, south, east, north] = t.bounds;
  const top = mercY(north);
  const bottom = mercY(south);
  const yRange = Math.max(top - bottom, 1e-12);
  const lng = west + (x / t.imageWidth) * (east - west);
  const my = top - (y / t.imageHeight) * yRange;
  const lat = ((2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180) / Math.PI;
  return [lng, lat];
}

/**
 * Build a canonical transform from decoded raster dimensions plus
 * Mercator-derived bounds. Use this everywhere bounds are computed.
 */
export function buildOverlayTransform(params: {
  imageWidth: number;
  imageHeight: number;
  bounds: [number, number, number, number];
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
  requestedWidth?: number;
}): OverlayTransform {
  return {
    imageWidth: params.imageWidth,
    imageHeight: params.imageHeight,
    bounds: params.bounds,
    center:
      params.centerLat != null && params.centerLng != null
        ? { lat: params.centerLat, lng: params.centerLng }
        : undefined,
    zoom: params.zoom,
    devicePixelRatio: params.requestedWidth
      ? params.imageWidth / params.requestedWidth
      : 1,
    projection: "web_mercator",
  };
}
