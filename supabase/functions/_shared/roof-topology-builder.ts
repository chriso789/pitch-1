// Unified Roof Topology Builder
// Combines straight skeleton generation with Solar orientation analysis
// Priority for ridge direction: Manual Override > Solar Segments > Skeleton-derived

import { computeStraightSkeleton } from './straight-skeleton.ts';
import { classifyBoundaryEdges, type BoundaryClassification } from '../measure/gable-detector.ts';
import { analyzeSegmentOrientation, type SolarSegmentOrientation } from './roof-analysis-helpers.ts';

export type XY = [number, number]; // [lng, lat]

export interface SkeletonEdge {
  id?: string;
  start: XY;
  end: XY;
  type: 'ridge' | 'hip' | 'valley';
  boundaryIndices?: number[];
  startVertexId?: string;
  endVertexId?: string;
  wingIndex?: number;
}

export interface RoofTopology {
  footprintCoords: XY[];
  skeleton: SkeletonEdge[];
  ridgeDirection: XY; // Normalized direction vector
  ridgeSource: 'solar_segments' | 'skeleton_derived' | 'manual_override';
  boundaryClassification: BoundaryClassification;
  isComplexShape: boolean;
  reflexVertexCount: number;
  warnings: string[];
}

export interface RidgeOverride {
  start: XY;
  end: XY;
}

export interface SolarSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2?: number;
  stats?: { areaMeters2: number };
}

export interface RoofTopologyOptions {
  footprintVertices: Array<{ lat: number; lng: number }>;
  solarSegments?: SolarSegment[];
  manualRidgeOverride?: RidgeOverride;
  eaveOffsetFt?: number;
}

// Convert {lat, lng} vertices to [lng, lat] array
function vertexArrayToXY(vertices: Array<{ lat: number; lng: number }>): XY[] {
  return vertices.map(v => [v.lng, v.lat] as XY);
}

// Normalize a vector
function normalizeVector(v: XY): XY {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2);
  if (len < 0.0000001) return [1, 0];
  return [v[0] / len, v[1] / len];
}

// Count reflex (concave) vertices
function countReflexVertices(coords: XY[]): number {
  let count = 0;
  const n = coords.length;
  
  for (let i = 0; i < n; i++) {
    const prev = coords[(i - 1 + n) % n];
    const curr = coords[i];
    const next = coords[(i + 1) % n];
    
    // Cross product to determine concavity
    const ax = prev[0] - curr[0];
    const ay = prev[1] - curr[1];
    const bx = next[0] - curr[0];
    const by = next[1] - curr[1];
    const cross = ax * by - ay * bx;
    
    if (cross < 0) count++;
  }
  
  return count;
}

// Get ridge direction from skeleton (longest ridge)
function getRidgeDirectionFromSkeleton(skeleton: SkeletonEdge[]): XY {
  const ridges = skeleton.filter(e => e.type === 'ridge');
  
  if (ridges.length === 0) {
    return [0, 0]; // No ridge - will be treated as hip roof
  }
  
  // Find longest ridge
  let longestRidge = ridges[0];
  let maxLen = 0;
  
  for (const ridge of ridges) {
    const len = Math.sqrt(
      (ridge.end[0] - ridge.start[0]) ** 2 + 
      (ridge.end[1] - ridge.start[1]) ** 2
    );
    if (len > maxLen) {
      maxLen = len;
      longestRidge = ridge;
    }
  }
  
  const vec: XY = [
    longestRidge.end[0] - longestRidge.start[0],
    longestRidge.end[1] - longestRidge.start[1]
  ];
  
  return normalizeVector(vec);
}

// Get ridge direction from Solar segment orientation
function getRidgeDirectionFromSolar(orientation: SolarSegmentOrientation): XY {
  // East-West ridge means segments face North/South
  // North-South ridge means segments face East/West
  if (orientation.primaryRidgeDirection === 'east-west') {
    return [1, 0]; // Ridge runs east-west
  } else {
    return [0, 1]; // Ridge runs north-south
  }
}

/**
 * Build complete roof topology from footprint
 * Includes skeleton, ridge direction, and boundary classification
 */
export function buildRoofTopology(options: RoofTopologyOptions): RoofTopology {
  const { 
    footprintVertices, 
    solarSegments, 
    manualRidgeOverride, 
    eaveOffsetFt = 1.0 
  } = options;
  
  const warnings: string[] = [];
  
  // Convert to coordinate array
  const coords = vertexArrayToXY(footprintVertices);
  
  // Ensure closed ring
  if (coords.length > 0) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push([...first]);
    }
  }
  
  // Remove closing vertex for processing
  const openCoords = coords.slice(0, -1);
  
  // Detect shape complexity
  const reflexCount = countReflexVertices(openCoords);
  const isComplexShape = openCoords.length > 6 || reflexCount > 0;
  
  if (isComplexShape) {
    console.log(`ℹ️ Complex building shape: ${openCoords.length} vertices, ${reflexCount} reflex corners`);
  }
  
  // Compute straight skeleton
  console.log(`🔧 Computing straight skeleton for ${openCoords.length} vertices...`);
  const skeleton = computeStraightSkeleton(openCoords, eaveOffsetFt);
  console.log(`   → Generated: ${skeleton.filter(e => e.type === 'ridge').length} ridges, ${skeleton.filter(e => e.type === 'hip').length} hips, ${skeleton.filter(e => e.type === 'valley').length} valleys`);
  
  // Determine ridge direction using PRIORITY ORDER:
  // 1. Manual override (from user trace)
  // 2. Solar segment analysis (high confidence)
  // 3. Skeleton-derived (fallback)
  
  let ridgeDirection: XY;
  let ridgeSource: RoofTopology['ridgeSource'];
  
  if (manualRidgeOverride) {
    // Priority 1: Manual override
    ridgeDirection = normalizeVector([
      manualRidgeOverride.end[0] - manualRidgeOverride.start[0],
      manualRidgeOverride.end[1] - manualRidgeOverride.start[1]
    ]);
    ridgeSource = 'manual_override';
    console.log(`🎯 Using MANUAL RIDGE override for topology`);
    
  } else if (solarSegments && solarSegments.length >= 2) {
    // Priority 2: Solar segment analysis
    const solarOrientation = analyzeSegmentOrientation(solarSegments);
    
    if (solarOrientation.confidence >= 0.7) {
      ridgeDirection = getRidgeDirectionFromSolar(solarOrientation);
      ridgeSource = 'solar_segments';
      console.log(`🌞 Using Solar segment analysis: ${solarOrientation.primaryRidgeDirection} ridge, ${(solarOrientation.confidence * 100).toFixed(0)}% confidence`);
      
      if (solarOrientation.hasMultipleRidges) {
        warnings.push('Multiple ridge directions detected - complex footprint');
      }
    } else {
      // Solar confidence too low, use skeleton
      ridgeDirection = getRidgeDirectionFromSkeleton(skeleton);
      ridgeSource = 'skeleton_derived';
      console.log(`📐 Solar confidence low (${(solarOrientation.confidence * 100).toFixed(0)}%), using skeleton-derived ridge`);
    }
    
  } else {
    // Priority 3: Skeleton-derived
    ridgeDirection = getRidgeDirectionFromSkeleton(skeleton);
    ridgeSource = 'skeleton_derived';
    console.log(`📐 Using skeleton-derived ridge direction`);
  }
  
  // Log ridge direction
  if (ridgeDirection[0] === 0 && ridgeDirection[1] === 0) {
    console.log(`   No ridge detected - treating as hip roof (all edges are eaves)`);
  } else {
    const angle = Math.atan2(ridgeDirection[1], ridgeDirection[0]) * 180 / Math.PI;
    console.log(`   Ridge direction: ${ridgeDirection[0].toFixed(4)}, ${ridgeDirection[1].toFixed(4)} (${angle.toFixed(1)}°)`);
  }
  
  // Classify boundary edges (eave vs rake)
  const boundaryClassification = classifyBoundaryEdges(
    openCoords,
    skeleton,
    manualRidgeOverride ? {
      start: manualRidgeOverride.start,
      end: manualRidgeOverride.end
    } : undefined
  );
  
  console.log(`   Boundary: ${boundaryClassification.eaveEdges.length} eaves, ${boundaryClassification.rakeEdges.length} rakes`);
  
  return {
    footprintCoords: openCoords,
    skeleton,
    ridgeDirection,
    ridgeSource,
    boundaryClassification,
    isComplexShape,
    reflexVertexCount: reflexCount,
    warnings
  };
}

/**
 * Calculate linear feature totals from topology
 */
export function calculateLinearTotals(topology: RoofTopology): {
  ridgeFt: number;
  hipFt: number;
  valleyFt: number;
  eaveFt: number;
  rakeFt: number;
  perimeterFt: number;
} {
  // Helper to calculate edge length in feet
  const edgeLengthFt = (start: XY, end: XY): number => {
    const midLat = (start[1] + end[1]) / 2;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
    const dx = (end[0] - start[0]) * metersPerDegLng;
    const dy = (end[1] - start[1]) * metersPerDegLat;
    return Math.sqrt(dx * dx + dy * dy) * 3.28084;
  };
  
  const ridgeFt = topology.skeleton
    .filter(e => e.type === 'ridge')
    .reduce((sum, e) => sum + edgeLengthFt(e.start, e.end), 0);
  
  const hipFt = topology.skeleton
    .filter(e => e.type === 'hip')
    .reduce((sum, e) => sum + edgeLengthFt(e.start, e.end), 0);
  
  const valleyFt = topology.skeleton
    .filter(e => e.type === 'valley')
    .reduce((sum, e) => sum + edgeLengthFt(e.start, e.end), 0);
  
  const eaveFt = topology.boundaryClassification.eaveEdges
    .reduce((sum, e) => sum + edgeLengthFt(e[0], e[1]), 0);
  
  const rakeFt = topology.boundaryClassification.rakeEdges
    .reduce((sum, e) => sum + edgeLengthFt(e[0], e[1]), 0);
  
  const perimeterFt = eaveFt + rakeFt;
  
  return { ridgeFt, hipFt, valleyFt, eaveFt, rakeFt, perimeterFt };
}

/**
 * Convert topology to linear features array for storage
 */
export function topologyToLinearFeatures(topology: RoofTopology): Array<{
  id: string;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  wkt: string;
  length_ft: number;
  label: string;
}> {
  const features: Array<{
    id: string;
    type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
    wkt: string;
    length_ft: number;
    label: string;
  }> = [];
  
  let id = 1;
  
  // Helper to calculate edge length
  const edgeLengthFt = (start: XY, end: XY): number => {
    const midLat = (start[1] + end[1]) / 2;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
    const dx = (end[0] - start[0]) * metersPerDegLng;
    const dy = (end[1] - start[1]) * metersPerDegLat;
    return Math.sqrt(dx * dx + dy * dy) * 3.28084;
  };
  
  // Add skeleton features
  for (const edge of topology.skeleton) {
    const length_ft = edgeLengthFt(edge.start, edge.end);
    if (length_ft < 3) continue; // Skip very short edges
    
    features.push({
      id: `LF${id++}`,
      type: edge.type,
      wkt: `LINESTRING(${edge.start[0]} ${edge.start[1]}, ${edge.end[0]} ${edge.end[1]})`,
      length_ft,
      label: `${edge.type.charAt(0).toUpperCase() + edge.type.slice(1)} ${id - 1}`
    });
  }
  
  // Add eave edges
  for (const edge of topology.boundaryClassification.eaveEdges) {
    const length_ft = edgeLengthFt(edge[0], edge[1]);
    if (length_ft < 3) continue;
    
    features.push({
      id: `LF${id++}`,
      type: 'eave',
      wkt: `LINESTRING(${edge[0][0]} ${edge[0][1]}, ${edge[1][0]} ${edge[1][1]})`,
      length_ft,
      label: `Eave ${id - 1}`
    });
  }
  
  // Add rake edges
  for (const edge of topology.boundaryClassification.rakeEdges) {
    const length_ft = edgeLengthFt(edge[0], edge[1]);
    if (length_ft < 3) continue;
    
    features.push({
      id: `LF${id++}`,
      type: 'rake',
      wkt: `LINESTRING(${edge[0][0]} ${edge[0][1]}, ${edge[1][0]} ${edge[1][1]})`,
      length_ft,
      label: `Rake ${id - 1}`
    });
  }
  
  return features;
}
