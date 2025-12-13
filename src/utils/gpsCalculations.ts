/**
 * GPS-Based Measurement Calculations
 * 
 * Provides accurate distance and area calculations using GPS coordinates
 * instead of pixel-based estimation. Uses Haversine formula for <0.5% error.
 */

export interface GPSCoord {
  lat: number;
  lng: number;
}

export interface ImageBounds {
  topLeft: GPSCoord;
  topRight: GPSCoord;
  bottomLeft: GPSCoord;
  bottomRight: GPSCoord;
  centerLat: number;
  centerLng: number;
  zoom: number;
}

export interface EdgeSegment {
  type: 'eave' | 'rake' | 'hip' | 'valley' | 'ridge' | 'step_flashing';
  start: GPSCoord;
  end: GPSCoord;
  lengthFt: number;
}

export interface GPSPolygon {
  points: GPSCoord[];
  areaSqft: number;
  perimeterFt: number;
  edges: EdgeSegment[];
  pitch?: string;
  pitchMultiplier?: number;
  adjustedAreaSqft?: number;
}

// Earth's radius in feet (mean radius)
const EARTH_RADIUS_FEET = 20902231;
const EARTH_RADIUS_METERS = 6371000;

// Pitch multipliers for area adjustment
export const PITCH_MULTIPLIERS: Record<string, number> = {
  'flat': 1.0,
  '0/12': 1.0,
  '1/12': 1.003,
  '2/12': 1.014,
  '3/12': 1.031,
  '4/12': 1.054,
  '5/12': 1.083,
  '6/12': 1.118,
  '7/12': 1.158,
  '8/12': 1.202,
  '9/12': 1.250,
  '10/12': 1.302,
  '11/12': 1.357,
  '12/12': 1.414,
};

/**
 * Convert degrees to radians
 */
function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * Returns distance in feet with <0.5% error
 */
export function haversineDistanceFeet(coord1: GPSCoord, coord2: GPSCoord): number {
  const dLat = toRad(coord2.lat - coord1.lat);
  const dLng = toRad(coord2.lng - coord1.lng);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(coord1.lat)) * Math.cos(toRad(coord2.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return EARTH_RADIUS_FEET * c;
}

/**
 * Calculate distance in meters (for display)
 */
export function haversineDistanceMeters(coord1: GPSCoord, coord2: GPSCoord): number {
  const dLat = toRad(coord2.lat - coord1.lat);
  const dLng = toRad(coord2.lng - coord1.lng);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(coord1.lat)) * Math.cos(toRad(coord2.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculate polygon area from GPS coordinates using spherical excess formula
 * Returns area in square feet
 */
export function calculateGPSPolygonArea(coords: GPSCoord[]): number {
  if (coords.length < 3) return 0;
  
  // Use local coordinate transformation for accurate area calculation
  // Convert GPS to meters centered on polygon centroid
  const centroid = {
    lat: coords.reduce((sum, c) => sum + c.lat, 0) / coords.length,
    lng: coords.reduce((sum, c) => sum + c.lng, 0) / coords.length,
  };
  
  // Convert to local meters using Haversine
  const metersPoints = coords.map(coord => {
    // Calculate X (east-west) distance
    const xDistance = haversineDistanceMeters(
      { lat: centroid.lat, lng: centroid.lng },
      { lat: centroid.lat, lng: coord.lng }
    ) * (coord.lng > centroid.lng ? 1 : -1);
    
    // Calculate Y (north-south) distance
    const yDistance = haversineDistanceMeters(
      { lat: centroid.lat, lng: centroid.lng },
      { lat: coord.lat, lng: centroid.lng }
    ) * (coord.lat > centroid.lat ? 1 : -1);
    
    return { x: xDistance, y: yDistance };
  });
  
  // Shoelace formula for area
  let area = 0;
  for (let i = 0; i < metersPoints.length; i++) {
    const j = (i + 1) % metersPoints.length;
    area += metersPoints[i].x * metersPoints[j].y;
    area -= metersPoints[j].x * metersPoints[i].y;
  }
  
  const areaSqMeters = Math.abs(area / 2);
  const areaSqFeet = areaSqMeters * 10.7639; // Convert sq meters to sq feet
  
  return Math.round(areaSqFeet * 100) / 100;
}

/**
 * Calculate polygon perimeter from GPS coordinates
 * Returns perimeter in feet
 */
export function calculateGPSPolygonPerimeter(coords: GPSCoord[]): number {
  if (coords.length < 2) return 0;
  
  let perimeter = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    perimeter += haversineDistanceFeet(coords[i], coords[j]);
  }
  
  return Math.round(perimeter * 100) / 100;
}

/**
 * Convert pixel coordinates to GPS coordinates
 */
export function pixelToGPS(
  pixel: { x: number; y: number },
  imageBounds: ImageBounds,
  imageSize: { width: number; height: number }
): GPSCoord {
  const latRange = imageBounds.topLeft.lat - imageBounds.bottomLeft.lat;
  const lngRange = imageBounds.topRight.lng - imageBounds.topLeft.lng;
  
  const lat = imageBounds.topLeft.lat - (pixel.y / imageSize.height) * latRange;
  const lng = imageBounds.topLeft.lng + (pixel.x / imageSize.width) * lngRange;
  
  return { lat, lng };
}

/**
 * Convert GPS coordinates to pixel coordinates
 */
export function gpsToPixel(
  coord: GPSCoord,
  imageBounds: ImageBounds,
  imageSize: { width: number; height: number }
): { x: number; y: number } {
  const latRange = imageBounds.topLeft.lat - imageBounds.bottomLeft.lat;
  const lngRange = imageBounds.topRight.lng - imageBounds.topLeft.lng;
  
  const x = ((coord.lng - imageBounds.topLeft.lng) / lngRange) * imageSize.width;
  const y = ((imageBounds.topLeft.lat - coord.lat) / latRange) * imageSize.height;
  
  return { x, y };
}

/**
 * Calculate image bounds from center coordinates and zoom level
 */
export function calculateImageBounds(
  centerLat: number,
  centerLng: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number
): ImageBounds {
  // Calculate meters per pixel at this zoom level using Web Mercator projection
  const metersPerPixel = (156543.03392 * Math.cos(toRad(centerLat))) / Math.pow(2, zoom);
  
  // Calculate degrees per pixel
  const degreesPerPixelLat = metersPerPixel / 111111; // ~111km per degree latitude
  const degreesPerPixelLng = metersPerPixel / (111111 * Math.cos(toRad(centerLat)));
  
  const halfWidth = (imageWidth / 2) * degreesPerPixelLng;
  const halfHeight = (imageHeight / 2) * degreesPerPixelLat;
  
  return {
    topLeft: { lat: centerLat + halfHeight, lng: centerLng - halfWidth },
    topRight: { lat: centerLat + halfHeight, lng: centerLng + halfWidth },
    bottomLeft: { lat: centerLat - halfHeight, lng: centerLng - halfWidth },
    bottomRight: { lat: centerLat - halfHeight, lng: centerLng + halfWidth },
    centerLat,
    centerLng,
    zoom,
  };
}

/**
 * Calculate pitch-adjusted area
 */
export function calculatePitchAdjustedArea(flatArea: number, pitch: string): number {
  const multiplier = PITCH_MULTIPLIERS[pitch] || 1.118; // Default to 6/12
  return Math.round(flatArea * multiplier * 100) / 100;
}

/**
 * Categorize edge segments by type and calculate totals
 */
export function categorizeEdges(edges: EdgeSegment[]): Record<string, number> {
  const totals: Record<string, number> = {
    eave: 0,
    rake: 0,
    hip: 0,
    valley: 0,
    ridge: 0,
    step_flashing: 0,
  };
  
  edges.forEach(edge => {
    if (totals[edge.type] !== undefined) {
      totals[edge.type] += edge.lengthFt;
    }
  });
  
  // Round all totals
  Object.keys(totals).forEach(key => {
    totals[key] = Math.round(totals[key] * 100) / 100;
  });
  
  return totals;
}

/**
 * Create an edge segment between two GPS coordinates
 */
export function createEdgeSegment(
  start: GPSCoord,
  end: GPSCoord,
  type: EdgeSegment['type']
): EdgeSegment {
  return {
    type,
    start,
    end,
    lengthFt: haversineDistanceFeet(start, end),
  };
}

/**
 * Validate a polygon before saving
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePolygon(polygon: GPSPolygon): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check minimum points
  if (polygon.points.length < 3) {
    errors.push('Polygon must have at least 3 points');
  }
  
  // Check area is reasonable (not too small or too large)
  if (polygon.areaSqft < 10) {
    errors.push('Polygon area is too small (<10 sq ft)');
  }
  if (polygon.areaSqft > 50000) {
    warnings.push('Polygon area is unusually large (>50,000 sq ft)');
  }
  
  // Check perimeter is reasonable
  if (polygon.perimeterFt < 10) {
    errors.push('Polygon perimeter is too short (<10 ft)');
  }
  
  // Check for self-intersection (basic check)
  // TODO: Implement proper self-intersection detection
  
  // Check pitch is assigned
  if (!polygon.pitch) {
    warnings.push('No pitch assigned (defaulting to 6/12)');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Calculate centroid of GPS polygon
 */
export function calculateCentroid(coords: GPSCoord[]): GPSCoord {
  const lat = coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
  const lng = coords.reduce((sum, c) => sum + c.lng, 0) / coords.length;
  return { lat, lng };
}

/**
 * Check if a point is inside a polygon (ray casting algorithm)
 */
export function isPointInPolygon(point: GPSCoord, polygon: GPSCoord[]): boolean {
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    
    if (((yi > point.lat) !== (yj > point.lat)) &&
        (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Snap a point to the nearest edge of a polygon
 */
export function snapToNearestEdge(
  point: GPSCoord,
  polygon: GPSCoord[],
  thresholdFeet: number = 5
): { snappedPoint: GPSCoord; edgeIndex: number } | null {
  let minDistance = Infinity;
  let closestPoint: GPSCoord | null = null;
  let closestEdgeIndex = -1;
  
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const start = polygon[i];
    const end = polygon[j];
    
    // Find closest point on edge
    const projected = projectPointOnLine(point, start, end);
    const distance = haversineDistanceFeet(point, projected);
    
    if (distance < minDistance && distance < thresholdFeet) {
      minDistance = distance;
      closestPoint = projected;
      closestEdgeIndex = i;
    }
  }
  
  if (closestPoint && closestEdgeIndex >= 0) {
    return { snappedPoint: closestPoint, edgeIndex: closestEdgeIndex };
  }
  
  return null;
}

/**
 * Project a point onto a line segment
 */
function projectPointOnLine(point: GPSCoord, lineStart: GPSCoord, lineEnd: GPSCoord): GPSCoord {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  const lengthSq = dx * dx + dy * dy;
  
  if (lengthSq === 0) return lineStart;
  
  let t = ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  
  return {
    lat: lineStart.lat + t * dy,
    lng: lineStart.lng + t * dx,
  };
}

/**
 * Convert GPS polygon to WKT format for database storage
 */
export function polygonToWKT(coords: GPSCoord[]): string {
  if (coords.length < 3) return '';
  
  // Close the polygon by adding first point at end
  const closedCoords = [...coords, coords[0]];
  const coordsString = closedCoords.map(c => `${c.lng} ${c.lat}`).join(', ');
  
  return `POLYGON((${coordsString}))`;
}

/**
 * Parse WKT polygon back to GPS coordinates
 */
export function wktToPolygon(wkt: string): GPSCoord[] {
  const match = wkt.match(/POLYGON\(\(([^)]+)\)\)/);
  if (!match) return [];
  
  const coords = match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(' ').map(Number);
    return { lat, lng };
  });
  
  // Remove the closing point (duplicate of first)
  if (coords.length > 1 && 
      coords[0].lat === coords[coords.length - 1].lat &&
      coords[0].lng === coords[coords.length - 1].lng) {
    coords.pop();
  }
  
  return coords;
}
