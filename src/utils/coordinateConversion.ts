/**
 * Coordinate conversion utilities for training overlay
 * 
 * IMPORTANT: The satellite image from Google Static Maps is 640x640 pixels.
 * When displayed on a canvas with different dimensions (e.g., 900x700),
 * the image is stretched, creating different scale factors for X and Y axes.
 * All coordinate conversions must account for this aspect ratio distortion.
 */

// Web Mercator constants
const EARTH_RADIUS = 6378137; // meters

// Original satellite image size (Google Static Maps returns 640x640)
const ORIGINAL_IMAGE_SIZE = 640;

/**
 * Convert lat/lng to canvas pixel coordinates with aspect ratio correction
 */
export function latLngToCanvasPixel(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number
): { x: number; y: number } {
  // Base meters per pixel for the ORIGINAL 640x640 square image
  const baseMetersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
  
  // Scale factors for aspect ratio correction
  const scaleX = canvasWidth / ORIGINAL_IMAGE_SIZE;
  const scaleY = canvasHeight / ORIGINAL_IMAGE_SIZE;
  
  // Effective meters-per-pixel on the stretched canvas
  const metersPerPixelX = baseMetersPerPixel / scaleX;
  const metersPerPixelY = baseMetersPerPixel / scaleY;
  
  // Meters per degree at this latitude
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);

  // Calculate offset from center
  const dLat = lat - centerLat;
  const dLng = lng - centerLng;
  
  // Convert to meters then to pixels (using separate scale for each axis)
  const dY = dLat * metersPerDegLat / metersPerPixelY;
  const dX = dLng * metersPerDegLng / metersPerPixelX;

  return {
    x: canvasWidth / 2 + dX,
    y: canvasHeight / 2 - dY, // Y is inverted in canvas
  };
}

/**
 * Convert canvas pixel coordinates to lat/lng with aspect ratio correction
 */
export function canvasPixelToLatLng(
  x: number,
  y: number,
  centerLat: number,
  centerLng: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number
): { lat: number; lng: number } {
  // Base meters per pixel for the ORIGINAL 640x640 square image
  const baseMetersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
  
  // Scale factors for aspect ratio correction
  const scaleX = canvasWidth / ORIGINAL_IMAGE_SIZE;
  const scaleY = canvasHeight / ORIGINAL_IMAGE_SIZE;
  
  // Effective meters-per-pixel on the stretched canvas
  const metersPerPixelX = baseMetersPerPixel / scaleX;
  const metersPerPixelY = baseMetersPerPixel / scaleY;
  
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);

  const dX = x - canvasWidth / 2;
  const dY = canvasHeight / 2 - y; // Y is inverted

  // Convert pixels to meters using separate scale for each axis
  const dLng = (dX * metersPerPixelX) / metersPerDegLng;
  const dLat = (dY * metersPerPixelY) / metersPerDegLat;

  return {
    lat: centerLat + dLat,
    lng: centerLng + dLng,
  };
}

/**
 * Parse WKT LINESTRING and convert to canvas points
 */
export function parseWKTToCanvasPoints(
  wkt: string,
  centerLat: number,
  centerLng: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number
): { x: number; y: number }[] {
  const match = wkt.match(/LINESTRING\s*\(([^)]+)\)/i);
  if (!match) return [];

  const coordPairs = match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return { lat, lng };
  });

  return coordPairs.map(coord => 
    latLngToCanvasPixel(
      coord.lat,
      coord.lng,
      centerLat,
      centerLng,
      canvasWidth,
      canvasHeight,
      zoom
    )
  );
}

/**
 * Parse WKT POLYGON and convert to canvas points
 */
export function parsePolygonWKTToCanvasPoints(
  wkt: string,
  centerLat: number,
  centerLng: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number
): { x: number; y: number }[] {
  const match = wkt.match(/POLYGON\s*\(\(([^)]+)\)\)/i);
  if (!match) return [];

  const coordPairs = match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return { lat, lng };
  });

  return coordPairs.map(coord => 
    latLngToCanvasPixel(
      coord.lat,
      coord.lng,
      centerLat,
      centerLng,
      canvasWidth,
      canvasHeight,
      zoom
    )
  );
}
