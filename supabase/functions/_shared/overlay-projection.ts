/**
 * Deno mirror of `src/lib/measurements/overlayProjection.ts`.
 *
 * Keep these two files BYTE-IDENTICAL in their math. Any edge-function
 * renderer (diagram SVG, PDF, training overlay) MUST import from this
 * file so the browser and server agree pixel-for-pixel.
 */

export interface OverlayTransform {
  imageWidth: number;
  imageHeight: number;
  bounds: [number, number, number, number]; // [west, south, east, north]
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

/**
 * Decode a satellite raster's true dimensions from its bytes.
 * Supports PNG and JPEG. Returns null if the format is unknown.
 *
 * This is critical: Mapbox/Google often return @2x rasters even when you
 * ask for 640×640, and computing bounds from the requested size shifts
 * every overlay by ~30 px on the diagonal.
 */
export async function decodeRasterSize(
  url: string,
): Promise<{ width: number; height: number } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());

  // PNG: 8-byte sig + IHDR chunk → width @ offset 16, height @ offset 20
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }

  // JPEG: walk markers to SOF0/SOF2
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = (buf[i + 2] << 8) | buf[i + 3];
      // SOF0..SOF15 (excluding DHT/DAC/DRI markers 0xC4, 0xC8, 0xCC)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const height = (buf[i + 5] << 8) | buf[i + 6];
        const width = (buf[i + 7] << 8) | buf[i + 8];
        return { width, height };
      }
      i += 2 + len;
    }
  }

  return null;
}
