/**
 * Geographic coordinate transformation utilities
 * Converts between lng/lat coordinates and pixel coordinates on satellite imagery
 */

const EARTH_RADIUS = 6378137; // Earth's radius in meters
const TILE_SIZE = 256; // Standard tile size for web maps

/**
 * Convert longitude to pixel X coordinate
 */
function lngToPixel(lng: number, zoom: number, imageWidth: number): number {
  const scale = imageWidth / 360;
  return (lng + 180) * scale * Math.pow(2, zoom - 8);
}

/**
 * Convert latitude to pixel Y coordinate (Web Mercator projection)
 */
function latToPixel(lat: number, zoom: number, imageHeight: number): number {
  const latRad = (lat * Math.PI) / 180;
  const mercatorY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const scale = imageHeight / (2 * Math.PI);
  return imageHeight / 2 - mercatorY * scale * Math.pow(2, zoom - 8);
}

/**
 * Convert pixel X coordinate to longitude
 */
function pixelToLng(x: number, zoom: number, imageWidth: number): number {
  const scale = imageWidth / 360;
  return x / (scale * Math.pow(2, zoom - 8)) - 180;
}

/**
 * Convert pixel Y coordinate to latitude
 */
function pixelToLat(y: number, zoom: number, imageHeight: number): number {
  const scale = imageHeight / (2 * Math.PI);
  const mercatorY = (imageHeight / 2 - y) / (scale * Math.pow(2, zoom - 8));
  const latRad = 2 * Math.atan(Math.exp(mercatorY)) - Math.PI / 2;
  return (latRad * 180) / Math.PI;
}

/**
 * Convert lng/lat to pixel coordinates relative to image center
 */
export function lngLatToPixel(
  lng: number,
  lat: number,
  centerLng: number,
  centerLat: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number } {
  const centerX = lngToPixel(centerLng, zoom, imageWidth);
  const centerY = latToPixel(centerLat, zoom, imageHeight);
  
  const pointX = lngToPixel(lng, zoom, imageWidth);
  const pointY = latToPixel(lat, zoom, imageHeight);
  
  return {
    x: pointX - centerX + imageWidth / 2,
    y: pointY - centerY + imageHeight / 2
  };
}

/**
 * Convert pixel coordinates to lng/lat
 */
export function pixelToLngLat(
  x: number,
  y: number,
  centerLng: number,
  centerLat: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number
): { lng: number; lat: number } {
  const centerX = lngToPixel(centerLng, zoom, imageWidth);
  const centerY = latToPixel(centerLat, zoom, imageHeight);
  
  const pointX = x - imageWidth / 2 + centerX;
  const pointY = y - imageHeight / 2 + centerY;
  
  return {
    lng: pixelToLng(pointX, zoom, imageWidth),
    lat: pixelToLat(pointY, zoom, imageHeight)
  };
}

/**
 * Calculate polygon area in square feet from lng/lat coordinates
 */
export function calculatePolygonAreaSqft(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  
  const midLat = coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((midLat * Math.PI) / 180);
  
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const x1 = lng1 * metersPerDegLng;
    const y1 = lat1 * metersPerDegLat;
    const x2 = lng2 * metersPerDegLng;
    const y2 = lat2 * metersPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  
  const areaM2 = Math.abs(area) / 2;
  return areaM2 * 10.7639; // Convert m² to sq ft
}

/**
 * Parse WKT polygon string to coordinate array
 */
export function parseWKTPolygon(wkt: string): [number, number][] {
  const match = wkt.match(/POLYGON\(\((.*?)\)\)/);
  if (!match) return [];
  
  const coordString = match[1];
  const coords = coordString.split(',').map(pair => {
    const [lng, lat] = pair.trim().split(' ').map(Number);
    return [lng, lat] as [number, number];
  });
  
  return coords;
}

/**
 * Calculate optimal zoom level for a bounding box
 */
export function calculateOptimalZoom(
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  imageWidth: number,
  imageHeight: number
): number {
  const lngDiff = bounds.maxLng - bounds.minLng;
  const latDiff = bounds.maxLat - bounds.minLat;
  
  // Calculate zoom based on longitude span
  const lngZoom = Math.floor(Math.log2(360 * imageWidth / (lngDiff * 256)));
  
  // Calculate zoom based on latitude span
  const latZoom = Math.floor(Math.log2(180 * imageHeight / (latDiff * 256)));
  
  // Use the more restrictive zoom level and cap at 20 (max for satellite imagery)
  return Math.min(Math.min(lngZoom, latZoom), 20);
}

/**
 * Get bounding box from coordinate array
 */
export function getBoundingBox(coords: [number, number][]): {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
} {
  return coords.reduce(
    (bounds, [lng, lat]) => ({
      minLng: Math.min(bounds.minLng, lng),
      maxLng: Math.max(bounds.maxLng, lng),
      minLat: Math.min(bounds.minLat, lat),
      maxLat: Math.max(bounds.maxLat, lat)
    }),
    { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity }
  );
}

/**
 * Convert coordinates to WKT polygon format
 */
export function toWKTPolygon(coords: [number, number][]): string {
  const coordString = coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ');
  return `POLYGON((${coordString}))`;
}
