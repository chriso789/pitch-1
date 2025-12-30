import * as turf from '@turf/turf';

export interface Point {
  x: number;
  y: number;
  lng?: number;
  lat?: number;
}

export interface Polygon {
  id: string;
  points: Point[];
  closed: boolean;
  color: string;
  label?: string;
}

/**
 * Calculate area of polygon in square feet using pixel coordinates and scale
 */
export function calculatePolygonArea(points: Point[], pixelsPerFoot: number = 1): number {
  if (points.length < 3) return 0;
  
  // Use shoelace formula for polygon area
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  
  area = Math.abs(area) / 2;
  
  // Convert from pixels to square feet
  const sqFeet = area / (pixelsPerFoot * pixelsPerFoot);
  return Math.round(sqFeet * 100) / 100;
}

/**
 * Calculate perimeter of polygon in feet
 */
export function calculatePolygonPerimeter(points: Point[], pixelsPerFoot: number = 1): number {
  if (points.length < 2) return 0;
  
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const dx = points[j].x - points[i].x;
    const dy = points[j].y - points[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  
  return Math.round((perimeter / pixelsPerFoot) * 100) / 100;
}

/**
 * Check if a point is near a line segment (for adding points to edges)
 */
export function isPointNearLine(
  point: Point,
  lineStart: Point,
  lineEnd: Point,
  threshold: number = 10
): boolean {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) return false;
  
  const t = Math.max(0, Math.min(1, 
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (length * length)
  ));
  
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  
  const distance = Math.sqrt(
    (point.x - projX) * (point.x - projX) + 
    (point.y - projY) * (point.y - projY)
  );
  
  return distance < threshold;
}

/**
 * Find which edge a point is closest to
 */
export function findClosestEdge(point: Point, polygon: Point[]): number | null {
  let minDistance = Infinity;
  let closestEdge = null;
  
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    
    if (isPointNearLine(point, polygon[i], polygon[j], 15)) {
      const dx = polygon[j].x - polygon[i].x;
      const dy = polygon[j].y - polygon[i].y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      const t = Math.max(0, Math.min(1, 
        ((point.x - polygon[i].x) * dx + (point.y - polygon[i].y) * dy) / (length * length)
      ));
      
      const projX = polygon[i].x + t * dx;
      const projY = polygon[i].y + t * dy;
      
      const distance = Math.sqrt(
        (point.x - projX) * (point.x - projX) + 
        (point.y - projY) * (point.y - projY)
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        closestEdge = i;
      }
    }
  }
  
  return closestEdge;
}

/**
 * Convert Google Solar API polygon to canvas points
 */
export function convertSolarPolygonToPoints(
  polygon: { lng: number; lat: number }[],
  centerLng: number,
  centerLat: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number
): Point[] {
  return polygon.map(coord => {
    const x = lngToPixel(coord.lng, centerLng, zoom, canvasWidth);
    const y = latToPixel(coord.lat, centerLat, zoom, canvasHeight);
    return { x, y, lng: coord.lng, lat: coord.lat };
  });
}

function lngToPixel(lng: number, centerLng: number, zoom: number, width: number): number {
  const scale = 256 * Math.pow(2, zoom);
  const centerX = (centerLng + 180) * (scale / 360);
  const pointX = (lng + 180) * (scale / 360);
  return width / 2 + (pointX - centerX);
}

function latToPixel(lat: number, centerLat: number, zoom: number, height: number): number {
  const scale = 256 * Math.pow(2, zoom);
  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const centerLatRad = (centerLat * Math.PI) / 180;
  const centerMercN = Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2));
  const centerY = (scale / 2) - (centerMercN * scale / (2 * Math.PI));
  const pointY = (scale / 2) - (mercN * scale / (2 * Math.PI));
  return height / 2 + (pointY - centerY);
}

/**
 * Generate distinct colors for polygons
 */
const POLYGON_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

export function getPolygonColor(index: number): string {
  return POLYGON_COLORS[index % POLYGON_COLORS.length];
}

/**
 * Smart roof type detection based on facet geometry
 */
export interface RoofTypeDetection {
  type: 'Gable' | 'Hip' | 'Flat' | 'Mansard' | 'Gambrel' | 'Dutch Hip' | 'Complex';
  confidence: number;
  complexity: number; // 1-5 scale
}

export function detectRoofType(measurement: any, tags: Record<string, any>): RoofTypeDetection {
  const faceCount = measurement?.faces?.length || 0;
  const ridgeCount = tags['ridge_lines']?.length || 0;
  const hipCount = tags['hip_lines']?.length || 0;
  const valleyCount = tags['valley_lines']?.length || 0;
  
  // Calculate complexity score (1-5 scale)
  const complexity = Math.min(5, Math.round(
    1 + (faceCount * 0.2) + (valleyCount * 0.3) + (hipCount * 0.1)
  ));
  
  let type: RoofTypeDetection['type'] = 'Complex';
  let confidence = 0.5;
  
  // Flat roof detection
  if (faceCount <= 2 && ridgeCount === 0 && hipCount === 0) {
    type = 'Flat';
    confidence = 0.9;
  }
  // Gable roof detection (2-4 faces, has ridge, minimal hips)
  else if (faceCount >= 2 && faceCount <= 4 && ridgeCount >= 1 && hipCount <= 1) {
    type = 'Gable';
    confidence = 0.85;
  }
  // Hip roof detection (4+ faces, multiple hips)
  else if (faceCount >= 4 && hipCount >= 2) {
    type = 'Hip';
    confidence = 0.8;
  }
  // Dutch Hip (combination of hip and gable features)
  else if (faceCount >= 4 && ridgeCount >= 1 && hipCount >= 2) {
    type = 'Dutch Hip';
    confidence = 0.75;
  }
  // Gambrel/Mansard (lots of faces, multiple ridges)
  else if (faceCount >= 6 && ridgeCount >= 2) {
    type = 'Gambrel';
    confidence = 0.7;
  }
  // Complex (everything else)
  else {
    type = 'Complex';
    confidence = 0.6;
  }
  
  return { type, confidence, complexity };
}

/**
 * Snap a point to the nearest edge of a polygon
 */
export function snapToEdge(point: Point, polygon: Point[], threshold: number = 15): Point | null {
  const closestEdgeIndex = findClosestEdge(point, polygon);
  
  if (closestEdgeIndex === null) return null;
  
  const start = polygon[closestEdgeIndex];
  const end = polygon[(closestEdgeIndex + 1) % polygon.length];
  
  // Calculate projection point on edge
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) return null;
  
  const t = Math.max(0, Math.min(1, 
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length)
  ));
  
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;

  return { x: projX, y: projY };
}

// ============= WKT Parsing Utilities =============

/**
 * Parse WKT POLYGON string to array of [lat, lng] coordinates
 * Format: "POLYGON((lng1 lat1, lng2 lat2, ...))"
 */
export function parseWKTPolygon(wkt: string): [number, number][] {
  if (!wkt || typeof wkt !== 'string') return [];
  
  const match = wkt.match(/POLYGON\(\(([^)]+)\)\)/);
  if (!match) return [];
  
  const coords = match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(' ').map(Number);
    return [lat, lng] as [number, number]; // Return as [lat, lng] tuple
  }).filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
  
  return coords;
}

/**
 * Parse WKT LINESTRING string to array of [lat, lng] coordinates
 * Format: "LINESTRING(lng1 lat1, lng2 lat2)"
 */
export function parseWKTLineString(wkt: string): [number, number][] {
  if (!wkt || typeof wkt !== 'string') return [];
  
  const match = wkt.match(/LINESTRING\(([^)]+)\)/);
  if (!match) return [];
  
  const coords = match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(' ').map(Number);
    return [lat, lng] as [number, number]; // Return as [lat, lng] tuple
  }).filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
  
  return coords;
}

/**
 * Convert array of [lat, lng] back to WKT POLYGON format
 */
export function coordsToWKTPolygon(coords: [number, number][]): string {
  if (coords.length < 3) return '';
  const wktCoords = coords.map(([lat, lng]) => `${lng} ${lat}`).join(', ');
  return `POLYGON((${wktCoords}))`;
}

/**
 * Simplify perimeter polygon to reduce jagged points
 * Uses Douglas-Peucker algorithm via turf.simplify
 */
export function simplifyPerimeter(wkt: string, tolerance: number = 0.000005): string {
  const coords = parseWKTPolygon(wkt);
  if (coords.length < 4) return wkt;
  
  try {
    // Convert to GeoJSON polygon (note: GeoJSON uses [lng, lat])
    const geoJsonCoords = coords.map(([lat, lng]) => [lng, lat]);
    
    // Ensure polygon is closed
    const first = geoJsonCoords[0];
    const last = geoJsonCoords[geoJsonCoords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      geoJsonCoords.push([...first]);
    }
    
    const polygon = turf.polygon([geoJsonCoords]);
    
    // Simplify with conservative tolerance
    const simplified = turf.simplify(polygon, { tolerance, highQuality: true });
    
    // Convert back to WKT format [lat, lng]
    const newCoords = simplified.geometry.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]);
    
    return coordsToWKTPolygon(newCoords);
  } catch (error) {
    console.error('Error simplifying perimeter:', error);
    return wkt; // Return original on error
  }
}

/**
 * Snap near-right angles to exact 90 degrees
 */
export function snapRightAngles(coords: [number, number][], angleTolerance: number = 10): [number, number][] {
  if (coords.length < 3) return coords;
  
  const result: [number, number][] = [];
  
  for (let i = 0; i < coords.length; i++) {
    const prev = coords[(i - 1 + coords.length) % coords.length];
    const curr = coords[i];
    const next = coords[(i + 1) % coords.length];
    
    // Calculate angle at current vertex
    const v1 = [curr[0] - prev[0], curr[1] - prev[1]];
    const v2 = [next[0] - curr[0], next[1] - curr[1]];
    
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    const angle = Math.abs(Math.atan2(cross, dot) * (180 / Math.PI));
    
    // Check if angle is near 90 degrees
    if (Math.abs(angle - 90) <= angleTolerance) {
      // Snap to exact 90 degrees by adjusting the current point
      // For now, keep original - more sophisticated snapping could be added
      result.push(curr);
    } else {
      result.push(curr);
    }
  }
  
  return result;
}

/**
 * Remove collinear points (points that lie on a straight line between neighbors)
 */
export function removeCollinearPoints(coords: [number, number][], angleTolerance: number = 5): [number, number][] {
  if (coords.length < 4) return coords;
  
  const result: [number, number][] = [];
  
  for (let i = 0; i < coords.length; i++) {
    const prev = coords[(i - 1 + coords.length) % coords.length];
    const curr = coords[i];
    const next = coords[(i + 1) % coords.length];
    
    // Calculate angle deviation from straight line
    const v1 = [curr[0] - prev[0], curr[1] - prev[1]];
    const v2 = [next[0] - curr[0], next[1] - curr[1]];
    
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    const angle = Math.abs(Math.atan2(cross, dot) * (180 / Math.PI));
    
    // If angle is not near 180 (i.e., not collinear), keep the point
    if (Math.abs(angle - 180) > angleTolerance && angle > angleTolerance) {
      result.push(curr);
    }
  }
  
  // Ensure we keep at least 3 points
  return result.length >= 3 ? result : coords;
}

/**
 * Apply all geometry cleanup operations
 */
export function cleanupGeometry(wkt: string, options?: {
  simplifyTolerance?: number;
  removeCollinear?: boolean;
  snapAngles?: boolean;
}): string {
  const {
    simplifyTolerance = 0.000005,
    removeCollinear = true,
    snapAngles = false
  } = options || {};
  
  let coords = parseWKTPolygon(wkt);
  if (coords.length < 3) return wkt;
  
  // Step 1: Apply simplification
  const simplified = simplifyPerimeter(wkt, simplifyTolerance);
  coords = parseWKTPolygon(simplified);
  
  // Step 2: Remove collinear points
  if (removeCollinear) {
    coords = removeCollinearPoints(coords);
  }
  
  // Step 3: Snap right angles (optional)
  if (snapAngles) {
    coords = snapRightAngles(coords);
  }
  
  return coordsToWKTPolygon(coords);
}

// ============= Bounds-Fit Coordinate Transformation =============

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  centerLat: number;
  centerLng: number;
}

/**
 * Calculate geographic bounds from WKT polygons and linear features
 */
export function calculateGeoBounds(
  perimeterWkt?: string,
  linearFeatures?: Array<{ wkt: string }>,
  faces?: Array<{ wkt: string }>,
  fallbackCenter?: { lat: number; lng: number }
): GeoBounds {
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  
  const processCoords = (coords: [number, number][]) => {
    coords.forEach(([lat, lng]) => {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    });
  };
  
  // Process perimeter
  if (perimeterWkt) {
    processCoords(parseWKTPolygon(perimeterWkt));
  }
  
  // Process faces
  faces?.forEach(face => {
    if (face.wkt) processCoords(parseWKTPolygon(face.wkt));
  });
  
  // Process linear features
  linearFeatures?.forEach(line => {
    if (line.wkt) processCoords(parseWKTLineString(line.wkt));
  });
  
  // Fallback if no valid data
  if (!isFinite(minLat) || !isFinite(maxLat)) {
    const center = fallbackCenter || { lat: 0, lng: 0 };
    return {
      minLat: center.lat - 0.001,
      maxLat: center.lat + 0.001,
      minLng: center.lng - 0.001,
      maxLng: center.lng + 0.001,
      centerLat: center.lat,
      centerLng: center.lng,
    };
  }
  
  return {
    minLat,
    maxLat,
    minLng,
    maxLng,
    centerLat: (minLat + maxLat) / 2,
    centerLng: (minLng + maxLng) / 2,
  };
}

/**
 * Create a bounds-fit coordinate transformer
 * This matches the approach used in SchematicRoofDiagram for consistent alignment
 */
export function createBoundsFitTransformer(
  bounds: GeoBounds,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 0.1
) {
  const latRange = (bounds.maxLat - bounds.minLat) * (1 + padding);
  const lngRange = (bounds.maxLng - bounds.minLng) * (1 + padding);
  const paddedMinLat = bounds.minLat - (bounds.maxLat - bounds.minLat) * padding / 2;
  const paddedMinLng = bounds.minLng - (bounds.maxLng - bounds.minLng) * padding / 2;
  
  // Calculate scale to fit canvas while maintaining aspect ratio
  const scaleX = canvasWidth / lngRange;
  const scaleY = canvasHeight / latRange;
  const scale = Math.min(scaleX, scaleY);
  
  // Center in canvas
  const offsetX = (canvasWidth - lngRange * scale) / 2;
  const offsetY = (canvasHeight - latRange * scale) / 2;
  
  return {
    toCanvas: (lat: number, lng: number): Point => ({
      x: offsetX + (lng - paddedMinLng) * scale,
      y: offsetY + (paddedMinLat + latRange - lat) * scale, // Flip Y for canvas
    }),
    toGeo: (x: number, y: number): { lat: number; lng: number } => ({
      lng: paddedMinLng + (x - offsetX) / scale,
      lat: paddedMinLat + latRange - (y - offsetY) / scale,
    }),
    bounds,
    scale,
    offset: { x: offsetX, y: offsetY },
  };
}
