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
 * Suggest split lines based on ridge/hip/valley data with enhanced scoring
 * Returns array of suggested split lines prioritized by quality
 */
export function suggestSplitLines(
  measurement: any,
  buildingPolygon: [number, number][]
): SplitLine[] {
  const suggestions: { line: SplitLine; score: number }[] = [];
  
  // Extract linear features from measurement
  const ridges = measurement.linear_features?.ridges || [];
  const hips = measurement.linear_features?.hips || [];
  const valleys = measurement.linear_features?.valleys || [];
  
  // Score features by type (ridge=1.0, hip=0.8, valley=0.6)
  const scoredFeatures = [
    ...ridges.map((f: any) => ({ feature: f, typeScore: 1.0 })),
    ...hips.map((f: any) => ({ feature: f, typeScore: 0.8 })),
    ...valleys.map((f: any) => ({ feature: f, typeScore: 0.6 })),
  ];
  
  for (const { feature, typeScore } of scoredFeatures) {
    if (feature.points && feature.points.length >= 2) {
      const start = feature.points[0];
      const end = feature.points[feature.points.length - 1];
      
      // Check if the line intersects the building polygon at exactly 2 points
      const line: SplitLine = { start, end };
      
      if (doesLineIntersectPolygon([start, end], buildingPolygon)) {
        // Calculate line length inside polygon
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const length = Math.sqrt(dx * dx + dy * dy);
        const lengthScore = Math.min(1.0, length / 0.5); // Normalize, longer is better
        
        // Calculate final score
        const finalScore = typeScore * 0.6 + lengthScore * 0.4;
        
        suggestions.push({ line, score: finalScore });
      }
    }
  }
  
  // Sort by score and return top suggestions
  return suggestions
    .sort((a, b) => b.score - a.score)
    .map(s => s.line);
}

/**
 * Detect symmetrical split lines using bilateral symmetry
 */
export function detectSymmetricalSplits(
  buildingPolygon: [number, number][]
): SplitLine[] {
  if (buildingPolygon.length < 3) return [];

  try {
    const polygon = turf.polygon([[...buildingPolygon, buildingPolygon[0]]]);
    const centroid = turf.centroid(polygon);
    const center = centroid.geometry.coordinates as [number, number];

    // Calculate bounding box
    const bbox = turf.bbox(polygon);
    const width = bbox[2] - bbox[0];
    const height = bbox[3] - bbox[1];

    // Primary axis is along the longer dimension
    const isHorizontalPrimary = width > height;
    const offset = Math.max(width, height) * 0.6;

    const splitLine: SplitLine = isHorizontalPrimary
      ? {
          start: [center[0] - offset, center[1]],
          end: [center[0] + offset, center[1]],
        }
      : {
          start: [center[0], center[1] - offset],
          end: [center[0], center[1] + offset],
        };

    // Check if split line intersects polygon properly
    if (doesLineIntersectPolygon([splitLine.start, splitLine.end], buildingPolygon)) {
      return [splitLine];
    }

    return [];
  } catch (error) {
    console.error('Error detecting symmetrical splits:', error);
    return [];
  }
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
 * Generate colors for facets based on pitch angle
 */
export function getFacetColor(index: number, pitch?: string): string {
  // If pitch is provided, color-code by pitch range
  if (pitch) {
    const pitchNum = parseInt(pitch.split('/')[0]);
    if (pitchNum <= 2) return '#e5e7eb'; // Flat - Light gray
    if (pitchNum <= 4) return '#93c5fd'; // Low slope - Light blue
    if (pitchNum <= 7) return '#3b82f6'; // Medium - Blue
    if (pitchNum <= 10) return '#6366f1'; // Steep - Indigo
    return '#8b5cf6'; // Very steep - Purple
  }

  // Fallback to index-based colors
  const FACET_COLORS = [
    '#64c8ff', '#ff9966', '#66ff99', '#ff6699',
    '#ffcc66', '#9966ff', '#66ffcc', '#ff6666',
  ];
  return FACET_COLORS[index % FACET_COLORS.length];
}

/**
 * Merge two adjacent facets into one
 */
export function mergeFacets(
  facet1: SplitFacet,
  facet2: SplitFacet
): SplitFacet | null {
  try {
    // Find shared edge points
    const shared: [number, number][] = [];
    for (const p1 of facet1.points) {
      for (const p2 of facet2.points) {
        if (Math.abs(p1[0] - p2[0]) < 0.001 && Math.abs(p1[1] - p2[1]) < 0.001) {
          shared.push(p1);
        }
      }
    }

    // Need at least 2 shared points to merge
    if (shared.length < 2) {
      console.log('Facets do not share an edge');
      return null;
    }

    // Combine points excluding shared edge
    const allPoints = [...facet1.points, ...facet2.points];
    const uniquePoints = allPoints.filter((point, index, self) => {
      return index === self.findIndex(p => 
        Math.abs(p[0] - point[0]) < 0.001 && Math.abs(p[1] - point[1]) < 0.001
      );
    });

    // Calculate merged area
    const mergedArea = facet1.area + facet2.area;

    // Preserve properties from larger facet
    const largerFacet = facet1.area > facet2.area ? facet1 : facet2;

    return {
      id: `merged-${Date.now()}`,
      points: uniquePoints,
      area: mergedArea,
      pitch: largerFacet.pitch,
      direction: largerFacet.direction,
      color: largerFacet.color,
    };
  } catch (error) {
    console.error('Error merging facets:', error);
    return null;
  }
}

/**
 * Export facets to WKT format
 */
export function exportFacetsToWKT(facets: SplitFacet[]): string {
  const wktPolygons = facets.map(facet => {
    const coords = facet.points.map(p => `${p[0]} ${p[1]}`).join(', ');
    const closed = `${coords}, ${facet.points[0][0]} ${facet.points[0][1]}`;
    return `POLYGON((${closed}))`;
  });

  return `GEOMETRYCOLLECTION(${wktPolygons.join(', ')})`;
}

/**
 * Import facets from WKT format
 */
export function importFacetsFromWKT(wkt: string): SplitFacet[] {
  try {
    // Simple WKT parser for POLYGON format
    const polygonRegex = /POLYGON\(\(([\d\s.,]+)\)\)/g;
    const facets: SplitFacet[] = [];
    let match;
    let index = 0;

    while ((match = polygonRegex.exec(wkt)) !== null) {
      const coords = match[1].trim().split(',').map(pair => {
        const [x, y] = pair.trim().split(/\s+/).map(Number);
        return [x, y] as [number, number];
      });

      // Remove duplicate last point if it closes the polygon
      if (coords.length > 1 && 
          coords[0][0] === coords[coords.length - 1][0] &&
          coords[0][1] === coords[coords.length - 1][1]) {
        coords.pop();
      }

      facets.push({
        id: `facet-${index}`,
        points: coords,
        area: calculatePolygonArea(coords),
        color: getFacetColor(index),
      });
      index++;
    }

    return facets;
  } catch (error) {
    console.error('Error parsing WKT:', error);
    return [];
  }
}
