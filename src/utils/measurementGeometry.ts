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
