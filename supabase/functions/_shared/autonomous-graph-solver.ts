/**
 * Autonomous Roof Graph Solver v3 — Prune-First, No Forced Closure
 * 
 * PHILOSOPHY CHANGE from v2:
 *   v2: "Make the data fit a valid roof" → forced graph closure → fake symmetry
 *   v3: "Only accept structures that naturally form a valid roof" → prune weak edges
 * 
 * KEY FIXES:
 *   1. Edge scoring + filtering BEFORE graph build (drop weak edges)
 *   2. Conservative snapping (no center collapse) — only snap if dist<5px AND angle<10deg
 *   3. NO forced intersection splitting — if edges don't naturally meet, drop weakest
 *   4. DSM physics-based classification (perpendicular cross-section, not geometry guesses)
 *   5. Facets from closed polygons with DSM plane-fit validation (no solar-segment mapping)
 *   6. Hard fail on under-segmented complex roofs
 * 
 * Patent-aligned: ONE canonical roof graph feeds all outputs.
 */

import type { DSMGrid, MaskedDSMGrid } from "./dsm-analyzer.ts";
import { geoToPixel, pixelToGeo } from "./dsm-analyzer.ts";
import { detectStructuralEdges, type DSMEdgeCandidate } from "./dsm-edge-detector.ts";
import {
  classifyEdgeByDSM,
  fitPlaneToPolygon,
  detectClosedPolygons,
  computeEdgeScore,
  edgeAngle,
  angleDifference,
} from "./dsm-utils.ts";
import { solveRoofPlanes as planarSolveRoofPlanes } from "./planar-roof-solver.ts";

type XY = [number, number]; // [lng, lat]

// ============= CONSTANTS =============

const EDGE_SCORE_THRESHOLD = 0.15;     // Minimum score to keep an edge (lowered from 0.25 to allow weaker DSM signals)
const SNAP_DISTANCE_METERS = 1.5;      // Max snap distance (~5px at 0.3m/px)
const SNAP_ANGLE_RAD = 10 * Math.PI / 180; // Max angle difference for snapping
const MIN_EDGE_LENGTH_FT = 3;          // Discard tiny edges
const MAX_INTERSECTIONS_PER_EDGE = 2;  // Drop edges with too many forced intersections
const PLANE_FIT_ERROR_THRESHOLD = 0.5; // meters — max RMS error for valid facet
const MIN_FACET_AREA_SQFT = 15;        // Discard tiny facets

// ============= TYPES =============

export interface EdgeConfidence {
  dsm_score: number;
  rgb_score: number;
  solar_azimuth_score: number;
  topology_score: number;
  length_score: number;
  final_confidence: number;
}

export interface GraphEdge {
  id: string;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  start: XY;
  end: XY;
  length_ft: number;
  confidence: EdgeConfidence;
  facet_ids: string[];
  source: 'dsm' | 'solar_segments' | 'skeleton' | 'fused' | 'perimeter';
}

export interface GraphFace {
  id: string;
  label: string;
  polygon: XY[];
  plan_area_sqft: number;
  roof_area_sqft: number;
  pitch_degrees: number;
  azimuth_degrees: number;
  edge_ids: string[];
}

export interface GraphVertex {
  id: string;
  position: XY;
  type: 'eave_corner' | 'ridge_endpoint' | 'valley_intersection' | 'hip_intersection';
  connected_edge_ids: string[];
}

export interface RejectedEdgeDebug {
  start: XY;
  end: XY;
  score: number;
  type: string;
  source: string;
  reason: string;
}

export interface AutonomousGraphResult {
  success: boolean;
  graph_connected: boolean;
  face_coverage_ratio: number;
  validation_status: 'validated' | 'ai_failed_complex_topology' | 'needs_review' | 'insufficient_structural_signal' | 'invalid_roof_graph' | 'dsm_edges_found_no_closed_faces' | 'incomplete_facet_coverage';
  failure_reason?: string;
  
  vertices: GraphVertex[];
  edges: GraphEdge[];
  faces: GraphFace[];
  rejected_edges: RejectedEdgeDebug[];
  
  totals: {
    ridge_ft: number;
    hip_ft: number;
    valley_ft: number;
    eave_ft: number;
    rake_ft: number;
    perimeter_ft: number;
    total_roof_area_sqft: number;
    total_plan_area_sqft: number;
    predominant_pitch: number;
  };

  logs: AutonomousGraphLog;
  topology_source: 'autonomous_dsm_graph_solver';
  facet_source: 'dsm_planar_graph_faces';
  fallback_used: false;
}

export interface AutonomousGraphLog {
  mask_vertices: number;
  dsm_ridges: number;
  dsm_valleys: number;
  dsm_hips: number;
  rgb_lines: number;
  solar_segments: number;
  fused_edges: number;
  rejected_edges: number;
  pruned_by_score: number;
  pruned_by_intersection: number;
  faces: number;
  faces_rejected_by_plane_fit: number;
  coverage_ratio: number;
  confidence: number;
  graph_valid: boolean;
  warnings: string[];
  timing_ms: number;
  dsm_edges_detected: number;
  dsm_edges_accepted: number;
  interior_lines_used: number;
  graph_nodes: number;
  graph_segments: number;
  intersections_split: number;
  dangling_edges_removed: number;
  faces_extracted: number;
  valid_faces: number;
  topology_source: 'autonomous_dsm_graph_solver';
  facet_source: 'dsm_planar_graph_faces';
  hard_fail_reason?: string | null;
}

export interface SolarSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  stats: { areaMeters2: number };
  center?: { latitude: number; longitude: number };
  boundingBox?: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  planeHeightAtCenterMeters?: number;
}

export interface AutonomousGraphInput {
  lat: number;
  lng: number;
  footprintCoords: XY[];
  solarSegments: SolarSegment[];
  dsmGrid: DSMGrid | null;
  maskedDSM: MaskedDSMGrid | null;
  skeletonEdges: Array<{ start: XY; end: XY; type: 'ridge' | 'hip' | 'valley' }>;
  boundaryEdges: {
    eaveEdges: [XY, XY][];
    rakeEdges: [XY, XY][];
  };
}

// ============= GEOMETRY HELPERS =============

function degToMeters(latDeg: number) {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(latDeg * Math.PI / 180);
  return { metersPerDegLat, metersPerDegLng };
}

function distanceFt(p1: XY, p2: XY, midLat: number): number {
  const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
  const dx = (p2[0] - p1[0]) * metersPerDegLng;
  const dy = (p2[1] - p1[1]) * metersPerDegLat;
  return Math.sqrt(dx * dx + dy * dy) * 3.28084;
}

function distanceMeters(p1: XY, p2: XY, midLat: number): number {
  const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
  const dx = (p2[0] - p1[0]) * metersPerDegLng;
  const dy = (p2[1] - p1[1]) * metersPerDegLat;
  return Math.sqrt(dx * dx + dy * dy);
}

function polygonAreaSqft(coords: XY[], midLat: number): number {
  if (coords.length < 3) return 0;
  const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
  let sum = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = coords[i][0] * metersPerDegLng, y1 = coords[i][1] * metersPerDegLat;
    const x2 = coords[j][0] * metersPerDegLng, y2 = coords[j][1] * metersPerDegLat;
    sum += (x1 * y2 - x2 * y1);
  }
  return Math.abs(sum) / 2 * 10.7639;
}

function midpoint(p1: XY, p2: XY): XY {
  return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}

function pitchFactor(pitchDeg: number): number {
  const rad = pitchDeg * Math.PI / 180;
  return 1 / Math.cos(rad);
}

function pointInPolygon(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function vertexKey(p: XY): string {
  return `${p[0].toFixed(8)},${p[1].toFixed(8)}`;
}

// ============= COMPLEXITY DETECTION =============

export function detectComplexRoof(
  solarSegments: SolarSegment[],
  footprintCoords: XY[]
): { isComplex: boolean; expectedMinFacets: number; reasons: string[] } {
  const reasons: string[] = [];
  let expectedMinFacets = 4;

  if (solarSegments.length > 4) {
    reasons.push(`${solarSegments.length} solar segments (>4)`);
    expectedMinFacets = Math.max(expectedMinFacets, solarSegments.length);
  }

  const vertexCount = footprintCoords.length;
  if (vertexCount > 4) {
    reasons.push(`${vertexCount} footprint vertices (non-rectangular/complex footprint)`);
    expectedMinFacets = Math.max(expectedMinFacets, 6);
  }

  let reflexCount = 0;
  const n = footprintCoords.length;
  for (let i = 0; i < n; i++) {
    const prev = footprintCoords[(i - 1 + n) % n];
    const curr = footprintCoords[i];
    const next = footprintCoords[(i + 1) % n];
    const cross = (prev[0] - curr[0]) * (next[1] - curr[1]) - (prev[1] - curr[1]) * (next[0] - curr[0]);
    if (cross < 0) reflexCount++;
  }
  if (reflexCount > 0) {
    reasons.push(`${reflexCount} reflex corners (L/T/U shape)`);
    expectedMinFacets = Math.max(expectedMinFacets, 6);
  }

  const azimuthGroups = new Set<number>();
  for (const seg of solarSegments) {
    const normalized = Math.round(((seg.azimuthDegrees || 0) % 360) / 45) * 45;
    azimuthGroups.add(normalized);
  }
  if (azimuthGroups.size > 4) {
    reasons.push(`${azimuthGroups.size} distinct azimuth groups`);
    expectedMinFacets = Math.max(expectedMinFacets, azimuthGroups.size);
  }

  return { isComplex: reasons.length > 0, expectedMinFacets, reasons };
}

// ============= INTERNAL EDGE TYPE =============

interface ScoredEdge {
  id: string;
  start: XY;
  end: XY;
  score: number;
  initialType: 'ridge' | 'valley' | 'hip';
  classifiedType: 'ridge' | 'valley' | 'hip' | 'eave' | 'rake';
  source: 'dsm' | 'skeleton' | 'fused';
  lengthFt: number;
}

// ============= STEP 1: SCORE & FILTER EDGES =============

function scoreAndFilterEdges(
  dsmEdges: DSMEdgeCandidate[],
  skeletonEdges: Array<{ start: XY; end: XY; type: 'ridge' | 'hip' | 'valley' }>,
  solarSegments: SolarSegment[],
  footprint: XY[],
  dsmGrid: DSMGrid | null,
  midLat: number,
  isComplex: boolean
): { accepted: ScoredEdge[]; prunedByScore: number; rejectedDebug: RejectedEdgeDebug[] } {
  const candidates: ScoredEdge[] = [];
  let edgeIdx = 0;
  let skippedByLength = 0, skippedByFootprint = 0;

  // Log coordinate spaces for debugging
  if (dsmEdges.length > 0) {
    const sample = dsmEdges[0];
    console.log(`[EDGE_SCORING] DSM edge sample: start=[${sample.start[0].toFixed(6)}, ${sample.start[1].toFixed(6)}]`);
  }
  if (footprint.length > 0) {
    console.log(`[EDGE_SCORING] Footprint sample: [${footprint[0][0].toFixed(6)}, ${footprint[0][1].toFixed(6)}]`);
  }

  // A. DSM edges — primary evidence
  for (const de of dsmEdges) {
    const lengthFt = distanceFt(de.start, de.end, midLat);
    if (lengthFt < MIN_EDGE_LENGTH_FT) { skippedByLength++; continue; }

    // Check if edge midpoint is within footprint
    const mid = midpoint(de.start, de.end);
    if (!pointInPolygon(mid, footprint) && !pointInPolygon(de.start, footprint) && !pointInPolygon(de.end, footprint)) {
      skippedByFootprint++;
      continue;
    }

    const score = computeEdgeScore(de.start, de.end, de.dsm_score, dsmGrid, midLat);

    candidates.push({
      id: `SE-${edgeIdx++}`,
      start: de.start,
      end: de.end,
      score,
      initialType: de.type,
      classifiedType: de.type,
      source: 'dsm',
      lengthFt,
    });
  }

  console.log(`[EDGE_SCORING] DSM edges: ${dsmEdges.length} total, ${skippedByLength} too short, ${skippedByFootprint} outside footprint, ${candidates.length} candidates`);

  // B. Skeleton edges — only for simple roofs, and only if no DSM edge covers same area
  if (!isComplex) {
    for (const skel of skeletonEdges) {
      const lengthFt = distanceFt(skel.start, skel.end, midLat);
      if (lengthFt < MIN_EDGE_LENGTH_FT) continue;

      const skelMid = midpoint(skel.start, skel.end);
      
      // Check for duplicate coverage
      const isDuplicate = candidates.some(c =>
        distanceMeters(midpoint(c.start, c.end), skelMid, midLat) < 5
      );
      if (isDuplicate) continue;

      const score = computeEdgeScore(skel.start, skel.end, 0.3, dsmGrid, midLat);

      candidates.push({
        id: `SE-${edgeIdx++}`,
        start: skel.start,
        end: skel.end,
        score: score * 0.7, // Penalty for skeleton-only
        initialType: skel.type,
        classifiedType: skel.type,
        source: 'skeleton',
        lengthFt,
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Filter by threshold
  const accepted = candidates.filter(c => c.score >= EDGE_SCORE_THRESHOLD);
  const rejected = candidates.filter(c => c.score < EDGE_SCORE_THRESHOLD);
  const prunedByScore = rejected.length;

  const rejectedDebug: RejectedEdgeDebug[] = rejected.map(c => ({
    start: c.start,
    end: c.end,
    score: c.score,
    type: c.classifiedType,
    source: c.source,
    reason: `score_${c.score.toFixed(3)}_below_${EDGE_SCORE_THRESHOLD}`,
  }));

  return { accepted, prunedByScore, rejectedDebug };
}

// ============= STEP 2: CONSERVATIVE SNAPPING (NO CENTER COLLAPSE) =============

function conservativeSnap(
  edges: ScoredEdge[],
  perimeterVertices: XY[],
  midLat: number
): ScoredEdge[] {
  // Build a list of "anchor" points: perimeter vertices + strong edge endpoints
  const anchors: XY[] = [...perimeterVertices];
  
  // Add endpoints of top-scored edges as anchors
  const topEdges = edges.slice(0, Math.min(edges.length, 5));
  for (const e of topEdges) {
    anchors.push(e.start, e.end);
  }

  return edges.map(edge => {
    let start = edge.start;
    let end = edge.end;

    // Try snapping each endpoint to nearest anchor IF conditions are met
    start = snapPointConservative(start, edge, anchors, edges, midLat);
    end = snapPointConservative(end, edge, anchors, edges, midLat);

    return { ...edge, start, end };
  });
}

function snapPointConservative(
  point: XY,
  ownerEdge: ScoredEdge,
  anchors: XY[],
  allEdges: ScoredEdge[],
  midLat: number
): XY {
  let bestDist = Infinity;
  let bestTarget: XY | null = null;

  // Check against other edge endpoints (not our own)
  for (const other of allEdges) {
    if (other.id === ownerEdge.id) continue;

    for (const otherPt of [other.start, other.end]) {
      const dist = distanceMeters(point, otherPt, midLat);
      if (dist >= SNAP_DISTANCE_METERS) continue;

      // Check angle compatibility
      const ownerAngle = edgeAngle(ownerEdge.start, ownerEdge.end);
      const otherAngle = edgeAngle(other.start, other.end);
      // We want edges meeting at a point — angle difference should NOT be near 0 (parallel)
      const aDiff = angleDifference(ownerAngle, otherAngle);
      if (aDiff < SNAP_ANGLE_RAD) continue; // Too parallel — don't snap (would force fake intersection)

      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = otherPt;
      }
    }
  }

  // Also check perimeter anchors (always OK to snap to perimeter)
  for (const anchor of anchors) {
    const dist = distanceMeters(point, anchor, midLat);
    if (dist < SNAP_DISTANCE_METERS && dist < bestDist) {
      bestDist = dist;
      bestTarget = anchor;
    }
  }

  return bestTarget || point;
}

// ============= STEP 3: REMOVE EDGES WITH TOO MANY FORCED INTERSECTIONS =============

function removeOverIntersectedEdges(edges: ScoredEdge[], midLat: number): { kept: ScoredEdge[]; pruned: number } {
  // Count intersections per edge
  const intersectionCounts = new Map<string, number>();

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const ip = segmentIntersection(edges[i].start, edges[i].end, edges[j].start, edges[j].end);
      if (ip) {
        intersectionCounts.set(edges[i].id, (intersectionCounts.get(edges[i].id) || 0) + 1);
        intersectionCounts.set(edges[j].id, (intersectionCounts.get(edges[j].id) || 0) + 1);
      }
    }
  }

  // Remove edges with too many intersections (they're likely hallucinated)
  // But keep edges sorted by score — only remove if they're low-scored AND over-intersected
  const kept: ScoredEdge[] = [];
  let pruned = 0;

  for (const edge of edges) {
    const count = intersectionCounts.get(edge.id) || 0;
    if (count > MAX_INTERSECTIONS_PER_EDGE && edge.score < 0.5) {
      pruned++;
      continue;
    }
    kept.push(edge);
  }

  return { kept, pruned };
}

function segmentIntersection(a1: XY, a2: XY, b1: XY, b2: XY): XY | null {
  const dx1 = a2[0] - a1[0], dy1 = a2[1] - a1[1];
  const dx2 = b2[0] - b1[0], dy2 = b2[1] - b1[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-14) return null;

  const t = ((b1[0] - a1[0]) * dy2 - (b1[1] - a1[1]) * dx2) / denom;
  const u = ((b1[0] - a1[0]) * dy1 - (b1[1] - a1[1]) * dx1) / denom;

  // Only count interior intersections (not at endpoints)
  if (t < 0.05 || t > 0.95 || u < 0.05 || u > 0.95) return null;

  return [a1[0] + t * dx1, a1[1] + t * dy1];
}

// ============= STEP 4: DSM PHYSICS CLASSIFICATION =============

function classifyEdgesWithDSM(edges: ScoredEdge[], dsmGrid: DSMGrid | null): ScoredEdge[] {
  if (!dsmGrid) return edges;

  return edges.map(edge => {
    const classified = classifyEdgeByDSM(edge.start, edge.end, dsmGrid);
    if (classified) {
      return { ...edge, classifiedType: classified };
    }
    return edge;
  });
}

// ============= STEP 5: BUILD GRAPH & EXTRACT FACES =============

interface SimpleGraph {
  vertices: Map<string, XY>;
  edges: Array<{
    v1: string;
    v2: string;
    type: 'ridge' | 'valley' | 'hip' | 'eave' | 'rake';
    score: number;
    source: string;
  }>;
  connected: boolean;
}

function buildGraph(
  structuralEdges: ScoredEdge[],
  perimeterEdges: Array<{ start: XY; end: XY; type: 'eave' | 'rake' }>,
  midLat: number
): SimpleGraph {
  const vertices = new Map<string, XY>();
  const edges: SimpleGraph['edges'] = [];

  const addVertex = (p: XY): string => {
    const key = vertexKey(p);
    if (!vertices.has(key)) vertices.set(key, p);
    return key;
  };

  // Add structural edges (already scored and filtered)
  for (const e of structuralEdges) {
    const v1 = addVertex(e.start);
    const v2 = addVertex(e.end);
    if (v1 === v2) continue;
    
    // Deduplicate
    const exists = edges.some(ex => (ex.v1 === v1 && ex.v2 === v2) || (ex.v1 === v2 && ex.v2 === v1));
    if (!exists) {
      edges.push({ v1, v2, type: e.classifiedType, score: e.score, source: e.source });
    }
  }

  // Add perimeter edges
  for (const e of perimeterEdges) {
    const v1 = addVertex(e.start);
    const v2 = addVertex(e.end);
    if (v1 === v2) continue;
    
    const exists = edges.some(ex => (ex.v1 === v1 && ex.v2 === v2) || (ex.v1 === v2 && ex.v2 === v1));
    if (!exists) {
      edges.push({ v1, v2, type: e.type, score: 0.85, source: 'perimeter' });
    }
  }

  // Check connectivity via BFS
  let connected = false;
  if (vertices.size > 0 && edges.length > 0) {
    const adjList = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!adjList.has(e.v1)) adjList.set(e.v1, new Set());
      if (!adjList.has(e.v2)) adjList.set(e.v2, new Set());
      adjList.get(e.v1)!.add(e.v2);
      adjList.get(e.v2)!.add(e.v1);
    }

    const visited = new Set<string>();
    const queue = [adjList.keys().next().value!];
    visited.add(queue[0]);
    while (queue.length > 0) {
      const curr = queue.pop()!;
      for (const nb of adjList.get(curr) || []) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
    connected = visited.size === vertices.size;
  }

  return { vertices, edges, connected };
}

function extractAndValidateFaces(
  graph: SimpleGraph,
  dsmGrid: DSMGrid | null,
  midLat: number,
  solarSegments: SolarSegment[]
): { faces: GraphFace[]; rejectedCount: number } {
  // Extract closed polygons from the graph
  const graphEdgesForPoly = graph.edges.map((e, i) => ({ v1: e.v1, v2: e.v2, id: `ge-${i}` }));
  const polygonVertexKeys = detectClosedPolygons(graphEdgesForPoly, graph.vertices);

  const faces: GraphFace[] = [];
  let rejectedCount = 0;
  let faceIdx = 0;

  for (const vertexKeys of polygonVertexKeys) {
    const polygon = vertexKeys.map(k => graph.vertices.get(k)!).filter(Boolean);
    if (polygon.length < 3) continue;

    // Compute area
    const areaSqft = polygonAreaSqft(polygon, midLat);
    if (areaSqft < MIN_FACET_AREA_SQFT) {
      rejectedCount++;
      continue;
    }

    // Validate with DSM plane fit
    if (dsmGrid) {
      const fitError = fitPlaneToPolygon(polygon, dsmGrid);
      if (fitError !== null && fitError > PLANE_FIT_ERROR_THRESHOLD) {
        rejectedCount++;
        console.log(`  Facet rejected: plane fit error ${fitError.toFixed(3)}m > ${PLANE_FIT_ERROR_THRESHOLD}m`);
        continue;
      }
    }

    // Find matching solar segment for pitch/azimuth
    const facetCenter = polygon.reduce((acc, p) => [acc[0] + p[0] / polygon.length, acc[1] + p[1] / polygon.length] as XY, [0, 0] as XY);
    const matchingSolar = findClosestSolarSegment(facetCenter, solarSegments);
    const pitch = matchingSolar?.pitchDegrees || 0;
    const azimuth = matchingSolar?.azimuthDegrees || 0;

    const label = String.fromCharCode(65 + faceIdx);
    const closedPolygon = [...polygon, polygon[0]]; // Close the ring

    // Find edge IDs that bound this face
    const faceEdgeIds: string[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const v1Key = vertexKeys[i];
      const v2Key = vertexKeys[(i + 1) % vertexKeys.length];
      const edgeIdx = graph.edges.findIndex(e =>
        (e.v1 === v1Key && e.v2 === v2Key) || (e.v1 === v2Key && e.v2 === v1Key)
      );
      if (edgeIdx >= 0) faceEdgeIds.push(`GE-${edgeIdx}`);
    }

    faces.push({
      id: `SF-${label}`,
      label,
      polygon: closedPolygon,
      plan_area_sqft: areaSqft,
      roof_area_sqft: areaSqft * pitchFactor(pitch),
      pitch_degrees: pitch,
      azimuth_degrees: azimuth,
      edge_ids: faceEdgeIds,
    });
    faceIdx++;
  }

  return { faces, rejectedCount };
}

function findClosestSolarSegment(point: XY, segments: SolarSegment[]): SolarSegment | null {
  if (segments.length === 0) return null;
  
  let best: SolarSegment | null = null;
  let bestDist = Infinity;

  for (const seg of segments) {
    if (!seg.center) continue;
    const dx = point[0] - seg.center.longitude;
    const dy = point[1] - seg.center.latitude;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = seg;
    }
  }

  return best;
}

function pxToGeoPoint(p: { x: number; y: number }, grid: DSMGrid): XY {
  return pixelToGeo(p.x, p.y, grid);
}

function geoToPxPoint(p: XY, grid: DSMGrid): { x: number; y: number } {
  const [x, y] = geoToPixel(p, grid);
  return { x, y };
}

function ptKeyPx(p: { x: number; y: number }): string {
  return `${Math.round(p.x)}:${Math.round(p.y)}`;
}

function pointNearPolyline(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }, tol = 6): boolean {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = Math.max(abx * abx + aby * aby, 1e-9);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const q = { x: a.x + abx * t, y: a.y + aby * t };
  return Math.hypot(q.x - p.x, q.y - p.y) <= tol;
}

function classifyPlanarSegment(
  seg: { a: { x: number; y: number }; b: { x: number; y: number } },
  footprintPx: Array<{ x: number; y: number }>,
  dsmInteriorEdgesPx: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; type: 'ridge' | 'valley' | 'hip'; score: number }>,
): { type: 'ridge' | 'valley' | 'hip' | 'eave' | 'rake'; score: number; source: 'dsm' | 'perimeter' } {
  const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
  for (let i = 0; i < footprintPx.length; i++) {
    if (pointNearPolyline(mid, footprintPx[i], footprintPx[(i + 1) % footprintPx.length], 4)) {
      return { type: 'eave', score: 0.85, source: 'perimeter' };
    }
  }

  let best: typeof dsmInteriorEdgesPx[number] | null = null;
  let bestDist = Infinity;
  for (const edge of dsmInteriorEdgesPx) {
    const d = Math.min(
      pointNearPolyline(seg.a, edge.a, edge.b, 8) ? 0 : 999,
      pointNearPolyline(seg.b, edge.a, edge.b, 8) ? 0 : 999,
      Math.hypot(mid.x - (edge.a.x + edge.b.x) / 2, mid.y - (edge.a.y + edge.b.y) / 2),
    );
    if (d < bestDist) {
      bestDist = d;
      best = edge;
    }
  }
  return best && bestDist < 20
    ? { type: best.type, score: best.score, source: 'dsm' }
    : { type: 'hip', score: 0.5, source: 'dsm' };
}

// ============= VALIDATION GATE =============

export function validateAutonomousResult(
  result: {
    facetCount: number;
    valleyCount: number;
    ridgeCount: number;
    hipCount: number;
    graphConnected: boolean;
    coverageRatio: number;
    structuralEdgeCount: number;
    dsmEdgesAccepted: number;
  },
  complexity: { isComplex: boolean; expectedMinFacets: number; reasons: string[] }
): { valid: boolean; status: AutonomousGraphResult['validation_status']; reason?: string } {

  // GATE 0: DSM edges exist but cannot close faces — honest failure.
  if (result.dsmEdgesAccepted >= 5 && result.facetCount < 2) {
    return {
      valid: false,
      status: 'dsm_edges_found_no_closed_faces',
      reason: `${result.dsmEdgesAccepted} accepted DSM structural edges found, but planar graph extracted only ${result.facetCount} valid faces`
    };
  }

  // GATE 0B: Insufficient structural signal
  if (result.structuralEdgeCount < 2) {
    return {
      valid: false,
      status: 'insufficient_structural_signal',
      reason: `Only ${result.structuralEdgeCount} structural edges survived scoring (need ≥2). DSM signal too weak.`
    };
  }

  // GATE 1: Must have at least one ridge or hip
  if (result.ridgeCount === 0 && result.hipCount === 0) {
    return {
      valid: false,
      status: 'invalid_roof_graph',
      reason: 'No ridges or hips detected — cannot form a valid roof structure'
    };
  }

  // GATE 2: Complex roof collapsed to ≤4 facets
  if (complexity.isComplex && result.facetCount <= 4) {
    return {
      valid: false,
      status: 'ai_failed_complex_topology',
      reason: `Complex roof (${complexity.reasons.join('; ')}) produced only ${result.facetCount} facets (expected ≥${complexity.expectedMinFacets})`
    };
  }

  // GATE 3: Complex roof with reflex corners but no valleys
  if (complexity.isComplex && complexity.reasons.some(r => r.includes('reflex')) && result.valleyCount === 0) {
    return {
      valid: false,
      status: 'ai_failed_complex_topology',
      reason: 'Complex footprint with reflex corners but no valleys detected — physically impossible'
    };
  }

  // GATE 4: Must have at least 2 facets
  if (result.facetCount < 2) {
    return {
      valid: false,
      status: 'invalid_roof_graph',
      reason: `Only ${result.facetCount} valid facets — need ≥2 for a roof`
    };
  }

  // GATE 5: Coverage ratio (if we have enough data)
  if (result.coverageRatio > 0 && result.coverageRatio < 0.85) {
    return {
      valid: false,
      status: 'incomplete_facet_coverage',
      reason: `DSM planar faces cover only ${(result.coverageRatio * 100).toFixed(1)}% of footprint (need ≥85%)`
    };
  }

  if (result.coverageRatio > 1.15) {
    return {
      valid: false,
      status: 'needs_review',
      reason: `Face coverage ratio ${result.coverageRatio.toFixed(2)} exceeds footprint bounds`
    };
  }

  // GATE 6: Complex roofs need ≥6 structural edges
  if (complexity.isComplex && result.structuralEdgeCount < 6) {
    return {
      valid: false,
      status: 'needs_review',
      reason: `Complex roof with only ${result.structuralEdgeCount} structural edges (need ≥6)`
    };
  }

  return { valid: true, status: 'validated' };
}

// ============= MAIN SOLVER =============

export function solveAutonomousGraph(input: AutonomousGraphInput): AutonomousGraphResult {
  const startMs = Date.now();
  const warnings: string[] = [];
  const midLat = input.lat;

  console.log(`[AUTONOMOUS_GRAPH_SOLVER] v3 — Prune-first pipeline`);
  console.log(`  Inputs: ${input.footprintCoords.length} footprint vertices, ${input.solarSegments.length} solar segments, DSM=${!!input.dsmGrid}, maskedDSM=${!!input.maskedDSM}, ${input.skeletonEdges.length} skeleton edges`);

  const footprintAreaSqft = polygonAreaSqft(input.footprintCoords, midLat);
  const complexity = detectComplexRoof(input.solarSegments, input.footprintCoords);

  if (complexity.isComplex) {
    console.log(`  COMPLEX ROOF: ${complexity.reasons.join('; ')}. Expected ≥${complexity.expectedMinFacets} facets.`);
  }

  // ===== STEP 1: DSM edge detection =====
  let dsmRidges: DSMEdgeCandidate[] = [];
  let dsmValleys: DSMEdgeCandidate[] = [];
  const effectiveDSM = input.maskedDSM || input.dsmGrid;

  if (effectiveDSM) {
    const mask = input.maskedDSM?.mask || null;
    const detection = detectStructuralEdges(effectiveDSM, mask);
    dsmRidges = detection.ridges;
    dsmValleys = detection.valleys;
    console.log(`  DSM edges: ${dsmRidges.length} ridges, ${dsmValleys.length} valleys (${detection.stats.processingMs}ms)`);
  } else {
    warnings.push('DSM not available — structural detection limited to skeleton');
  }

  // ===== STEP 2: Score & filter (PRUNE BEFORE GRAPH) =====
  const { accepted: scoredEdges, prunedByScore, rejectedDebug: rejectedEdgesDebug } = scoreAndFilterEdges(
    [...dsmRidges, ...dsmValleys],
    input.skeletonEdges,
    input.solarSegments,
    input.footprintCoords,
    effectiveDSM,
    midLat,
    complexity.isComplex
  );

  console.log(`  Scoring: ${scoredEdges.length} accepted, ${prunedByScore} pruned by score (threshold ${EDGE_SCORE_THRESHOLD})`);

  // ===== STEP 3: Conservative snapping (NO center collapse) =====
  const perimeterVertices: XY[] = [];
  for (const [s, e] of input.boundaryEdges.eaveEdges) { perimeterVertices.push(s, e); }
  for (const [s, e] of input.boundaryEdges.rakeEdges) { perimeterVertices.push(s, e); }

  const snappedEdges = conservativeSnap(scoredEdges, perimeterVertices, midLat);

  // ===== STEP 4: Remove over-intersected edges =====
  const { kept: cleanEdges, pruned: prunedByIntersection } = removeOverIntersectedEdges(snappedEdges, midLat);
  if (prunedByIntersection > 0) {
    console.log(`  Pruned ${prunedByIntersection} over-intersected edges`);
  }

  // ===== STEP 5: DSM physics classification =====
  const classifiedEdges = classifyEdgesWithDSM(cleanEdges, effectiveDSM);

  // Log classification results
  const ridgeCount = classifiedEdges.filter(e => e.classifiedType === 'ridge').length;
  const valleyCount = classifiedEdges.filter(e => e.classifiedType === 'valley').length;
  const hipCount = classifiedEdges.filter(e => e.classifiedType === 'hip').length;
  console.log(`  DSM classification: ${ridgeCount} ridges, ${valleyCount} valleys, ${hipCount} hips`);

  // ===== STEP 6: DSM topology guarantee via planar graph faces =====
  const footprintPx = effectiveDSM
    ? input.footprintCoords.map((p) => geoToPxPoint(p, effectiveDSM))
    : [];
  const dsmInteriorEdgesPx = effectiveDSM
    ? classifiedEdges
        .filter((e) => e.source === 'dsm' && (e.classifiedType === 'ridge' || e.classifiedType === 'hip' || e.classifiedType === 'valley'))
        .map((e) => ({
          a: geoToPxPoint(e.start, effectiveDSM),
          b: geoToPxPoint(e.end, effectiveDSM),
          type: e.classifiedType as 'ridge' | 'valley' | 'hip',
          score: e.score,
        }))
    : [];
  const planar = effectiveDSM && footprintPx.length >= 3
    ? planarSolveRoofPlanes(footprintPx, dsmInteriorEdgesPx)
    : { faces: [], edges: [], debug: { input_footprint_vertices: 0, input_interior_lines: 0, snapped_interior_lines: 0, intersections_split: 0, dangling_edges_removed: 0, total_graph_segments: 0, total_graph_nodes: 0, faces_extracted: 0, faces_with_area: 0, face_coverage_ratio: 0 } };
  console.log(`  DSM planar graph: ${planar.debug.total_graph_nodes} nodes, ${planar.debug.total_graph_segments} segments, ${planar.faces.length} valid faces, coverage=${planar.debug.face_coverage_ratio}`);

  let facesRejected = 0;
  const graphFaces: GraphFace[] = [];
  for (const face of planar.faces) {
    const polygon = effectiveDSM ? face.polygon.map((p) => pxToGeoPoint(p, effectiveDSM)) : [];
    if (polygon.length < 3) continue;
    if (effectiveDSM) {
      const fitError = fitPlaneToPolygon(polygon, effectiveDSM);
      if (fitError !== null && fitError > PLANE_FIT_ERROR_THRESHOLD) {
        facesRejected++;
        continue;
      }
    }
    const areaSqft = polygonAreaSqft(polygon, midLat);
    if (areaSqft < MIN_FACET_AREA_SQFT) {
      facesRejected++;
      continue;
    }
    const facetCenter = polygon.reduce((acc, p) => [acc[0] + p[0] / polygon.length, acc[1] + p[1] / polygon.length] as XY, [0, 0] as XY);
    const matchingSolar = findClosestSolarSegment(facetCenter, input.solarSegments);
    const pitch = matchingSolar?.pitchDegrees || 0;
    const azimuth = matchingSolar?.azimuthDegrees || 0;
    const closedPolygon = vertexKey(polygon[0]) === vertexKey(polygon[polygon.length - 1]) ? polygon : [...polygon, polygon[0]];
    graphFaces.push({
      id: `SF-${String.fromCharCode(65 + graphFaces.length)}`,
      label: String.fromCharCode(65 + graphFaces.length),
      polygon: closedPolygon,
      plan_area_sqft: areaSqft,
      roof_area_sqft: areaSqft * pitchFactor(pitch),
      pitch_degrees: pitch,
      azimuth_degrees: azimuth,
      edge_ids: [],
    });
  }

  // ===== Convert planar segments to output edges =====
  let edgeId = 0;
  const outputEdges: GraphEdge[] = [];
  const outputVerticesByKey = new Map<string, XY>();
  const addVertex = (p: XY) => outputVerticesByKey.set(vertexKey(p), p);
  for (const seg of planar.edges) {
    if (!effectiveDSM) continue;
    const start = pxToGeoPoint(seg.a, effectiveDSM);
    const end = pxToGeoPoint(seg.b, effectiveDSM);
    const lengthFt = distanceFt(start, end, midLat);
    if (lengthFt < 1) continue;
    const classified = classifyPlanarSegment(seg, footprintPx, dsmInteriorEdgesPx);
    addVertex(start);
    addVertex(end);
    outputEdges.push({
      id: `GE-${edgeId++}`,
      type: classified.type,
      start,
      end,
      length_ft: lengthFt,
      confidence: {
        dsm_score: classified.source === 'dsm' ? 0.85 : 0.8,
        rgb_score: 0,
        solar_azimuth_score: 0.5,
        topology_score: planar.faces.length >= 2 ? 0.9 : 0.2,
        length_score: lengthFt > 10 ? 0.8 : 0.5,
        final_confidence: classified.score,
      },
      facet_ids: [],
      source: classified.source,
    });
  }
  console.log(`  Faces: ${graphFaces.length} valid, ${facesRejected} rejected by plane fit/area`);

  // Totals
  const outRidges = outputEdges.filter(e => e.type === 'ridge');
  const outHips = outputEdges.filter(e => e.type === 'hip');
  const outValleys = outputEdges.filter(e => e.type === 'valley');
  const outEaves = outputEdges.filter(e => e.type === 'eave');
  const outRakes = outputEdges.filter(e => e.type === 'rake');
  const structuralEdgeCount = outRidges.length + outHips.length + outValleys.length;

  const totalRoofArea = graphFaces.reduce((s, f) => s + f.roof_area_sqft, 0);
  const totalPlanArea = graphFaces.reduce((s, f) => s + f.plan_area_sqft, 0);
  const coverageRatio = planar.debug.face_coverage_ratio || (footprintAreaSqft > 0 ? totalPlanArea / footprintAreaSqft : 0);

  const pitchWeighted = graphFaces.reduce((s, f) => s + f.pitch_degrees * f.roof_area_sqft, 0);
  const predominantPitch = totalRoofArea > 0 ? pitchWeighted / totalRoofArea : 0;

  const avgConfidence = outputEdges.length > 0
    ? outputEdges.reduce((s, e) => s + e.confidence.final_confidence, 0) / outputEdges.length
    : 0;

  // ===== VALIDATION GATE =====
  const validation = validateAutonomousResult(
    {
      facetCount: graphFaces.length,
      valleyCount: outValleys.length,
      ridgeCount: outRidges.length,
      hipCount: outHips.length,
      graphConnected: graphFaces.length >= 2 && coverageRatio >= 0.85,
      coverageRatio,
      structuralEdgeCount,
      dsmEdgesAccepted: classifiedEdges.filter(e => e.source === 'dsm').length,
    },
    complexity
  );

  // Build vertex output
  const outputVertices: GraphVertex[] = [];
  let vId = 0;
  for (const [key, pos] of outputVerticesByKey) {
    const connectedEdgeIds = outputEdges
      .filter(e => vertexKey(e.start) === key || vertexKey(e.end) === key)
      .map(e => e.id);

    const hasRidge = outputEdges.some(e => e.type === 'ridge' && (vertexKey(e.start) === key || vertexKey(e.end) === key));
    const hasValley = outputEdges.some(e => e.type === 'valley' && (vertexKey(e.start) === key || vertexKey(e.end) === key));
    const hasHip = outputEdges.some(e => e.type === 'hip' && (vertexKey(e.start) === key || vertexKey(e.end) === key));
    const isPerimeter = outputEdges.some(e => (e.type === 'eave' || e.type === 'rake') && (vertexKey(e.start) === key || vertexKey(e.end) === key));

    outputVertices.push({
      id: `GV-${vId++}`,
      position: pos,
      type: isPerimeter ? 'eave_corner' : hasValley ? 'valley_intersection' : hasHip ? 'hip_intersection' : 'ridge_endpoint',
      connected_edge_ids: connectedEdgeIds,
    });
  }

  const timingMs = Date.now() - startMs;

  const logs: AutonomousGraphLog = {
    mask_vertices: input.footprintCoords.length,
    dsm_ridges: dsmRidges.length,
    dsm_valleys: dsmValleys.length,
    dsm_hips: 0,
    rgb_lines: 0,
    solar_segments: input.solarSegments.length,
    fused_edges: scoredEdges.length,
    rejected_edges: prunedByScore,
    pruned_by_score: prunedByScore,
    pruned_by_intersection: prunedByIntersection,
    faces: graphFaces.length,
    faces_rejected_by_plane_fit: facesRejected,
    coverage_ratio: coverageRatio,
    confidence: avgConfidence,
    graph_valid: graphFaces.length >= 2 && coverageRatio >= 0.85,
    warnings,
    timing_ms: timingMs,
    dsm_edges_detected: dsmRidges.length + dsmValleys.length,
    dsm_edges_accepted: classifiedEdges.filter(e => e.source === 'dsm').length,
    interior_lines_used: dsmInteriorEdgesPx.length,
    graph_nodes: planar.debug.total_graph_nodes,
    graph_segments: planar.debug.total_graph_segments,
    intersections_split: planar.debug.intersections_split,
    dangling_edges_removed: planar.debug.dangling_edges_removed,
    faces_extracted: planar.debug.faces_extracted,
    valid_faces: graphFaces.length,
    topology_source: 'autonomous_dsm_graph_solver',
    facet_source: 'dsm_planar_graph_faces',
    hard_fail_reason: validation.valid ? null : validation.status,
  };

  console.log(`[DSM_STRUCTURE] ${JSON.stringify(logs)}`);
  console.log(`[AUTONOMOUS_GRAPH_SOLVER] Validation: ${validation.status}${validation.reason ? ` — ${validation.reason}` : ''}`);

  return {
    success: validation.valid,
    graph_connected: graphFaces.length >= 2 && coverageRatio >= 0.85,
    face_coverage_ratio: coverageRatio,
    validation_status: validation.status,
    failure_reason: validation.reason,
    vertices: outputVertices,
    edges: outputEdges,
    faces: graphFaces,
    totals: {
      ridge_ft: outRidges.reduce((s, e) => s + e.length_ft, 0),
      hip_ft: outHips.reduce((s, e) => s + e.length_ft, 0),
      valley_ft: outValleys.reduce((s, e) => s + e.length_ft, 0),
      eave_ft: outEaves.reduce((s, e) => s + e.length_ft, 0),
      rake_ft: outRakes.reduce((s, e) => s + e.length_ft, 0),
      perimeter_ft: outEaves.reduce((s, e) => s + e.length_ft, 0) + outRakes.reduce((s, e) => s + e.length_ft, 0),
      total_roof_area_sqft: totalRoofArea,
      total_plan_area_sqft: totalPlanArea,
      predominant_pitch: predominantPitch,
    },
    logs,
    topology_source: 'autonomous_dsm_graph_solver',
    facet_source: 'dsm_planar_graph_faces',
    fallback_used: false,
  };
}

function getBounds(coords: XY[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = coords.map(c => c[0]);
  const ys = coords.map(c => c[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
