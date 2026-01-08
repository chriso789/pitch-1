/**
 * Coordinate conversion utilities for training overlay
 */

// Web Mercator constants
const EARTH_RADIUS = 6378137; // meters

/**
 * Convert lat/lng to canvas pixel coordinates
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
  // Calculate meters per pixel at this zoom level and latitude
  const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
  
  // Meters per degree at this latitude
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);

  // Calculate offset from center
  const dLat = lat - centerLat;
  const dLng = lng - centerLng;
  
  // Convert to meters then to pixels
  const dY = dLat * metersPerDegLat / metersPerPixel;
  const dX = dLng * metersPerDegLng / metersPerPixel;

  return {
    x: canvasWidth / 2 + dX,
    y: canvasHeight / 2 - dY, // Y is inverted in canvas
  };
}

/**
 * Convert canvas pixel coordinates to lat/lng
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
  const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);

  const dX = x - canvasWidth / 2;
  const dY = canvasHeight / 2 - y; // Y is inverted

  const dLng = (dX * metersPerPixel) / metersPerDegLng;
  const dLat = (dY * metersPerPixel) / metersPerDegLat;

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
