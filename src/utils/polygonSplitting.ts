import * as turf from '@turf/turf';
import type { Position } from 'geojson';

export interface SplitLine {
  start: [number, number];
  end: [number, number];
}

export interface SplitFacet {
  id: string;
  points: [number, number][];
  area: number;
  pitch?: string;
  direction?: string;
  color: string;
}

/**
 * Split a polygon by a line using intersection calculation
 * Returns two polygons if split is successful, null if invalid
 */
export function splitPolygonByLine(
  polygonPoints: [number, number][],
  splitLine: SplitLine
): { facet1: [number, number][]; facet2: [number, number][] } | null {
  try {
    // Find intersection points between the line and polygon edges
    const intersectionPoints: Array<{ point: [number, number]; edgeIndex: number }> = [];
    
    for (let i = 0; i < polygonPoints.length; i++) {
      const p1 = polygonPoints[i];
      const p2 = polygonPoints[(i + 1) % polygonPoints.length];
      
      const intersection = lineIntersection(splitLine.start, splitLine.end, p1, p2);
      if (intersection) {
        intersectionPoints.push({ point: intersection, edgeIndex: i });
      }
    }
    
    // We need exactly 2 intersection points
    if (intersectionPoints.length !== 2) {
      console.log('Split line must intersect polygon at exactly 2 points, found:', intersectionPoints.length);
      return null;
    }
    
    // Sort intersection points by distance along the split line
    intersectionPoints.sort((a, b) => {
      const distA = Math.hypot(a.point[0] - splitLine.start[0], a.point[1] - splitLine.start[1]);
      const distB = Math.hypot(b.point[0] - splitLine.start[0], b.point[1] - splitLine.start[1]);
      return distA - distB;
    });
    
    const [int1, int2] = intersectionPoints;
    
    // Build two facets by walking around the polygon
    const facet1: [number, number][] = [];
    const facet2: [number, number][] = [];
    
    // Add points to facet1: from int1 to int2
    facet1.push(int1.point);
    let currentIndex = (int1.edgeIndex + 1) % polygonPoints.length;
    while (currentIndex !== (int2.edgeIndex + 1) % polygonPoints.length) {
      facet1.push(polygonPoints[currentIndex]);
      currentIndex = (currentIndex + 1) % polygonPoints.length;
    }
    facet1.push(int2.point);
    
    // Add points to facet2: from int2 to int1 (other direction)
    facet2.push(int2.point);
    currentIndex = (int2.edgeIndex + 1) % polygonPoints.length;
    while (currentIndex !== (int1.edgeIndex + 1) % polygonPoints.length) {
      facet2.push(polygonPoints[currentIndex]);
      currentIndex = (currentIndex + 1) % polygonPoints.length;
    }
    facet2.push(int1.point);
    
    // Validate the resulting polygons
    if (facet1.length < 3 || facet2.length < 3) {
      console.log('Invalid split: not enough points in resulting facets');
      return null;
    }
    
    return { facet1, facet2 };
  } catch (error) {
    console.error('Error splitting polygon:', error);
    return null;
  }
}

/**
 * Calculate intersection point between two line segments
 * Returns null if lines don't intersect
 */
function lineIntersection(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number]
): [number, number] | null {
  const x1 = a1[0], y1 = a1[1];
  const x2 = a2[0], y2 = a2[1];
  const x3 = b1[0], y3 = b1[1];
  const x4 = b2[0], y4 = b2[1];
  
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 0.0001) return null; // Parallel lines
  
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  
  // Check if intersection is within both line segments (with small tolerance for edge cases)
  if (t >= -0.0001 && t <= 1.0001 && u >= -0.0001 && u <= 1.0001) {
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }
  
  return null;
}

/**
 * Suggest split lines based on ridge/hip/valley data
 * Returns array of suggested split lines
 */
export function suggestSplitLines(
  measurement: any,
  buildingPolygon: [number, number][]
): SplitLine[] {
  const suggestions: SplitLine[] = [];
  
  // Extract linear features from measurement
  const ridges = measurement.linear_features?.ridges || [];
  const hips = measurement.linear_features?.hips || [];
  const valleys = measurement.linear_features?.valleys || [];
  
  // Combine all linear features
  const allFeatures = [...ridges, ...hips, ...valleys];
  
  // For each linear feature, check if it can be a split line
  for (const feature of allFeatures) {
    if (feature.points && feature.points.length >= 2) {
      const start = feature.points[0];
      const end = feature.points[feature.points.length - 1];
      
      // Check if the line intersects the building polygon
      if (doesLineIntersectPolygon([start, end], buildingPolygon)) {
        suggestions.push({ start, end });
      }
    }
  }
  
  return suggestions;
}

/**
 * Check if a line intersects a polygon
 */
function doesLineIntersectPolygon(
  line: [[number, number], [number, number]],
  polygon: [number, number][]
): boolean {
  try {
    const lineFeature = turf.lineString(line);
    const closedPolygon = [...polygon];
    if (
      closedPolygon[0][0] !== closedPolygon[closedPolygon.length - 1][0] ||
      closedPolygon[0][1] !== closedPolygon[closedPolygon.length - 1][1]
    ) {
      closedPolygon.push(closedPolygon[0]);
    }
    const polygonFeature = turf.polygon([closedPolygon]);
    
    const intersection = turf.lineIntersect(lineFeature, polygonFeature);
    return intersection.features.length >= 2; // Must intersect at 2+ points to cross
  } catch (error) {
    return false;
  }
}

/**
 * Calculate area of polygon in square feet
 */
export function calculatePolygonArea(points: [number, number][]): number {
  try {
    const closedPoints = [...points];
    if (
      closedPoints[0][0] !== closedPoints[closedPoints.length - 1][0] ||
      closedPoints[0][1] !== closedPoints[closedPoints.length - 1][1]
    ) {
      closedPoints.push(closedPoints[0]);
    }
    
    const polygon = turf.polygon([closedPoints]);
    const areaMeters = turf.area(polygon);
    const areaSqFt = areaMeters * 10.7639; // Convert m² to ft²
    return Math.round(areaSqFt * 100) / 100;
  } catch (error) {
    console.error('Error calculating area:', error);
    return 0;
  }
}

/**
 * Generate distinct colors for facets
 */
const FACET_COLORS = [
  '#64c8ff', // Light blue
  '#ff9966', // Orange
  '#66ff99', // Light green
  '#ff6699', // Pink
  '#ffcc66', // Yellow
  '#9966ff', // Purple
  '#66ffcc', // Cyan
  '#ff6666', // Red
];

export function getFacetColor(index: number): string {
  return FACET_COLORS[index % FACET_COLORS.length];
}
