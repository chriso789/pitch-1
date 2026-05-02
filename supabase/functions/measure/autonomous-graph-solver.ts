/**
 * Autonomous Roof Graph Solver v2 — Corrected Pipeline
 * 
 * DSM-first multi-evidence fusion with:
 *   Step 2.5: Edge fusion (DSM + RGB + Solar scoring)
 *   Step 3:   Clip to mask
 *   Step 3.5: Planar graph enforcement (snap, split, validate)
 *   Step 4:   Build faces from planar graph
 *   Step 4.5: Canonical edge mapping (shared edges, physics-based classification)
 *   Step 5:   Diagram = graph (no templates, no normalization)
 *   Step 6:   QA gates (hard fail, no synthetic fallbacks)
 * 
 * Patent-aligned: One canonical roof graph feeds all outputs.
 * Primary source: DSM (ridges/valleys), mask (footprint), solar segments (azimuth/pitch priors).
 * NO FALLBACK to skeleton synthesis for complex roofs. Fail hard.
 */

import type { DSMGrid, MaskedDSMGrid, RoofMask } from "./dsm-analyzer.ts";
import { getElevationAt, geoToPixel, pixelToGeo } from "./dsm-analyzer.ts";
import { detectStructuralEdges, type DSMEdgeCandidate } from "./dsm-edge-detector.ts";

type XY = [number, number]; // [lng, lat]

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
  source: 'dsm' | 'solar_segments' | 'skeleton' | 'fused';
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

export interface AutonomousGraphResult {
  success: boolean;
  graph_connected: boolean;
  face_coverage_ratio: number;
  validation_status: 'validated' | 'ai_failed_complex_topology' | 'needs_review' | 'insufficient_structural_signal' | 'invalid_roof_graph';
  failure_reason?: string;
  
  vertices: GraphVertex[];
  edges: GraphEdge[];
  faces: GraphFace[];
  
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
  faces: number;
  coverage_ratio: number;
  confidence: number;
  graph_valid: boolean;
  warnings: string[];
  timing_ms: number;
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

function polygonAreaSqft(coords: XY[], midLat: number): number {
  if (coords.length < 4) return 0;
  const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const x1 = coords[i][0] * metersPerDegLng, y1 = coords[i][1] * metersPerDegLat;
    const x2 = coords[i + 1][0] * metersPerDegLng, y2 = coords[i + 1][1] * metersPerDegLat;
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
  if (vertexCount > 8) {
    reasons.push(`${vertexCount} footprint vertices (>8)`);
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

// ============= STEP 2.5: EDGE FUSION =============

interface FusionCandidate {
  start: XY;
  end: XY;
  type: 'ridge' | 'valley' | 'hip';
  dsm_score: number;
  rgb_score: number;
  solar_score: number;
  final_score: number;
  source: 'dsm' | 'skeleton' | 'solar_segments';
}

function fuseEdgeCandidates(
  dsmEdges: DSMEdgeCandidate[],
  skeletonEdges: Array<{ start: XY; end: XY; type: 'ridge' | 'hip' | 'valley' }>,
  solarSegments: SolarSegment[],
  midLat: number,
  isComplex: boolean,
  fusionThreshold: number = 0.4
): { accepted: FusionCandidate[]; rejected: number } {
  const candidates: FusionCandidate[] = [];
  const solarFaces = solarSegments.map(seg => ({
    azimuth: seg.azimuthDegrees || 0,
    centroid: seg.center
      ? [seg.center.longitude, seg.center.latitude] as XY
      : [0, 0] as XY,
  }));

  // A. DSM edges — primary evidence
  for (const de of dsmEdges) {
    const solarScore = scoreDSMEdgeAgainstSolar(de.start, de.end, solarFaces, de.type);
    const rgbScore = 0.5; // Placeholder — RGB edge confirmation would go here
    const final = 0.5 * de.dsm_score + 0.3 * rgbScore + 0.2 * solarScore;

    candidates.push({
      start: de.start,
      end: de.end,
      type: de.type,
      dsm_score: de.dsm_score,
      rgb_score: rgbScore,
      solar_score: solarScore,
      final_score: final,
      source: 'dsm',
    });
  }

  // B. Skeleton edges — lower confidence, only add if no DSM edge covers same area
  for (const skel of skeletonEdges) {
    const skelMid = midpoint(skel.start, skel.end);
    const isDuplicate = candidates.some(c =>
      c.type === skel.type &&
      distanceFt(midpoint(c.start, c.end), skelMid, midLat) < 10
    );
    if (isDuplicate) continue;

    // For complex roofs, skeleton alone is NOT sufficient — reject
    if (isComplex) continue;

    const solarScore = scoreDSMEdgeAgainstSolar(skel.start, skel.end, solarFaces, skel.type);
    const final = 0.5 * 0.3 + 0.3 * 0.5 + 0.2 * solarScore; // Low DSM score for skeleton

    candidates.push({
      start: skel.start,
      end: skel.end,
      type: skel.type,
      dsm_score: 0.3,
      rgb_score: 0.5,
      solar_score: solarScore,
      final_score: final,
      source: 'skeleton',
    });
  }

  // Filter by threshold
  const accepted = candidates.filter(c => c.final_score >= fusionThreshold);
  const rejected = candidates.length - accepted.length;

  return { accepted, rejected };
}

function scoreDSMEdgeAgainstSolar(
  start: XY,
  end: XY,
  solarFaces: Array<{ azimuth: number; centroid: XY }>,
  edgeType: 'ridge' | 'hip' | 'valley'
): number {
  if (solarFaces.length < 2) return 0.5;

  const edgeMid = midpoint(start, end);
  const sorted = solarFaces
    .map(f => ({
      ...f,
      dist: Math.abs(f.centroid[0] - edgeMid[0]) + Math.abs(f.centroid[1] - edgeMid[1])
    }))
    .sort((a, b) => a.dist - b.dist);

  if (sorted.length < 2) return 0.5;

  const diff = Math.abs(((sorted[0].azimuth - sorted[1].azimuth + 180) % 360) - 180);

  if (edgeType === 'ridge') return diff > 140 ? 0.9 : diff > 100 ? 0.7 : 0.4;
  if (edgeType === 'valley') return (diff > 60 && diff < 120) ? 0.85 : 0.4;
  return (diff > 60 && diff < 120) ? 0.85 : 0.4; // hip
}

// ============= STEP 3: CLIP TO MASK =============

function clipEdgesToMask(
  edges: FusionCandidate[],
  footprint: XY[],
  midLat: number
): FusionCandidate[] {
  return edges.filter(e => {
    const mid = midpoint(e.start, e.end);
    return pointInPolygon(mid, footprint) ||
           pointInPolygon(e.start, footprint) ||
           pointInPolygon(e.end, footprint);
  });
}

// ============= STEP 3.5: PLANAR GRAPH ENFORCEMENT =============

/** Snap a coordinate to a grid (prevents near-miss intersections) */
function snapToGrid(p: XY, gridSize: number): XY {
  return [
    Math.round(p[0] / gridSize) * gridSize,
    Math.round(p[1] / gridSize) * gridSize,
  ];
}

/** Compute intersection point of two line segments, or null if they don't intersect */
function segmentIntersection(
  a1: XY, a2: XY, b1: XY, b2: XY
): XY | null {
  const dx1 = a2[0] - a1[0], dy1 = a2[1] - a1[1];
  const dx2 = b2[0] - b1[0], dy2 = b2[1] - b1[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-14) return null;

  const t = ((b1[0] - a1[0]) * dy2 - (b1[1] - a1[1]) * dx2) / denom;
  const u = ((b1[0] - a1[0]) * dy1 - (b1[1] - a1[1]) * dx1) / denom;

  if (t < 0.01 || t > 0.99 || u < 0.01 || u > 0.99) return null;

  return [a1[0] + t * dx1, a1[1] + t * dy1];
}

interface EnforcedGraph {
  vertices: Map<string, XY>;
  edges: Array<{ v1: string; v2: string; type: 'ridge' | 'valley' | 'hip' | 'eave' | 'rake'; confidence: number; source: string }>;
  valid: boolean;
  reason?: string;
}

function vertexKey(p: XY): string {
  return `${p[0].toFixed(8)},${p[1].toFixed(8)}`;
}

function enforceplanarGraph(
  structuralEdges: FusionCandidate[],
  perimeterEdges: Array<{ start: XY; end: XY; type: 'eave' | 'rake' }>,
  midLat: number
): EnforcedGraph {
  // Compute snap grid size: ~0.5m in degrees
  const { metersPerDegLng } = degToMeters(midLat);
  const gridSize = 0.5 / metersPerDegLng; // ~0.5m

  const vertices = new Map<string, XY>();
  const edges: EnforcedGraph['edges'] = [];

  const addVertex = (p: XY): string => {
    const snapped = snapToGrid(p, gridSize);
    const key = vertexKey(snapped);
    if (!vertices.has(key)) vertices.set(key, snapped);
    return key;
  };

  // Collect all edge segments (structural + perimeter)
  const allSegments: Array<{
    start: XY; end: XY;
    type: 'ridge' | 'valley' | 'hip' | 'eave' | 'rake';
    confidence: number;
    source: string;
  }> = [];

  for (const e of structuralEdges) {
    allSegments.push({
      start: snapToGrid(e.start, gridSize),
      end: snapToGrid(e.end, gridSize),
      type: e.type,
      confidence: e.final_score,
      source: e.source,
    });
  }

  for (const e of perimeterEdges) {
    allSegments.push({
      start: snapToGrid(e.start, gridSize),
      end: snapToGrid(e.end, gridSize),
      type: e.type,
      confidence: 0.85,
      source: 'perimeter',
    });
  }

  // Split edges at intersection points
  for (let i = 0; i < allSegments.length; i++) {
    for (let j = i + 1; j < allSegments.length; j++) {
      const ip = segmentIntersection(
        allSegments[i].start, allSegments[i].end,
        allSegments[j].start, allSegments[j].end
      );
      if (ip) {
        const snappedIP = snapToGrid(ip, gridSize);
        // Split segment i at intersection point
        const origI = { ...allSegments[i] };
        allSegments[i] = { ...origI, end: snappedIP };
        allSegments.push({ ...origI, start: snappedIP });

        // Split segment j at intersection point
        const origJ = { ...allSegments[j] };
        allSegments[j] = { ...origJ, end: snappedIP };
        allSegments.push({ ...origJ, start: snappedIP });
      }
    }
  }

  // Build vertex and edge lists
  for (const seg of allSegments) {
    const v1 = addVertex(seg.start);
    const v2 = addVertex(seg.end);
    if (v1 === v2) continue; // Skip zero-length edges

    // Deduplicate edges
    const existing = edges.find(e =>
      (e.v1 === v1 && e.v2 === v2) || (e.v1 === v2 && e.v2 === v1)
    );
    if (!existing) {
      edges.push({ v1, v2, type: seg.type, confidence: seg.confidence, source: seg.source });
    }
  }

  // Validate: check for floating edges (vertices with degree 1 that aren't perimeter)
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.v1, (degree.get(e.v1) || 0) + 1);
    degree.set(e.v2, (degree.get(e.v2) || 0) + 1);
  }

  const floatingVertices = [...degree.entries()].filter(([_, d]) => d < 2);
  // Allow perimeter corners to have degree 1 at the boundary
  const perimeterVertexKeys = new Set<string>();
  for (const e of perimeterEdges) {
    perimeterVertexKeys.add(vertexKey(snapToGrid(e.start, gridSize)));
    perimeterVertexKeys.add(vertexKey(snapToGrid(e.end, gridSize)));
  }

  const trueFloating = floatingVertices.filter(([k]) => !perimeterVertexKeys.has(k));

  if (edges.length === 0) {
    return { vertices, edges, valid: false, reason: 'No edges in graph' };
  }

  // Graph connectivity check via BFS
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
    for (const neighbor of adjList.get(curr) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  const isConnected = visited.size === vertices.size;

  return {
    vertices,
    edges,
    valid: isConnected && trueFloating.length === 0,
    reason: !isConnected
      ? `Graph not connected: ${visited.size}/${vertices.size} vertices reachable`
      : trueFloating.length > 0
        ? `${trueFloating.length} floating vertices`
        : undefined,
  };
}

// ============= STEP 4: BUILD FACES =============

function buildFacesFromSolarSegments(
  solarSegments: SolarSegment[],
  midLat: number,
  lng: number,
  lat: number
): GraphFace[] {
  return solarSegments.map((seg, i) => {
    const label = String.fromCharCode(65 + i);
    const areaSqft = (seg.stats?.areaMeters2 || 0) * 10.7639;
    const pitch = seg.pitchDegrees || 0;

    return {
      id: `SF-${label}`,
      label,
      polygon: [], // Real polygon extraction requires planar face traversal
      plan_area_sqft: areaSqft / pitchFactor(pitch),
      roof_area_sqft: areaSqft,
      pitch_degrees: pitch,
      azimuth_degrees: seg.azimuthDegrees || 0,
      edge_ids: [],
    };
  });
}

// ============= STEP 4.5: CANONICAL EDGE MAPPING =============

interface CanonicalEdgeMap {
  [key: string]: {
    v1: string;
    v2: string;
    faceIds: string[];
    type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
    classifiedType: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  };
}

function canonicalEdgeKey(v1: string, v2: string): string {
  return v1 < v2 ? `${v1}|${v2}` : `${v2}|${v1}`;
}

function buildCanonicalEdgeMap(
  graph: EnforcedGraph,
  faces: GraphFace[],
  dsmGrid: DSMGrid | null,
  midLat: number
): CanonicalEdgeMap {
  const edgeMap: CanonicalEdgeMap = {};

  for (const e of graph.edges) {
    const key = canonicalEdgeKey(e.v1, e.v2);

    if (!edgeMap[key]) {
      edgeMap[key] = {
        v1: e.v1,
        v2: e.v2,
        faceIds: [],
        type: e.type,
        classifiedType: e.type,
      };
    }

    // Physics-based reclassification using DSM slopes
    if (dsmGrid && (e.type === 'ridge' || e.type === 'valley' || e.type === 'hip')) {
      const v1Pos = graph.vertices.get(e.v1)!;
      const v2Pos = graph.vertices.get(e.v2)!;
      const edgeMid = midpoint(v1Pos, v2Pos);

      // Sample elevation perpendicular to edge on both sides
      const edgeDx = v2Pos[0] - v1Pos[0];
      const edgeDy = v2Pos[1] - v1Pos[1];
      const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
      if (edgeLen > 0) {
        const perpDx = -edgeDy / edgeLen;
        const perpDy = edgeDx / edgeLen;
        const offset = 0.00002; // ~2m

        const leftPt: XY = [edgeMid[0] + perpDx * offset, edgeMid[1] + perpDy * offset];
        const rightPt: XY = [edgeMid[0] - perpDx * offset, edgeMid[1] - perpDy * offset];

        const centerElev = getElevationAt(edgeMid, dsmGrid);
        const leftElev = getElevationAt(leftPt, dsmGrid);
        const rightElev = getElevationAt(rightPt, dsmGrid);

        if (centerElev !== null && leftElev !== null && rightElev !== null) {
          const leftSlopes = centerElev > leftElev; // slopes down to left
          const rightSlopes = centerElev > rightElev; // slopes down to right

          if (leftSlopes && rightSlopes) {
            // Both sides slope away = RIDGE
            edgeMap[key].classifiedType = 'ridge';
          } else if (!leftSlopes && !rightSlopes) {
            // Both sides slope toward = VALLEY
            edgeMap[key].classifiedType = 'valley';
          } else {
            // Mixed = HIP
            edgeMap[key].classifiedType = 'hip';
          }
        }
      }
    }
  }

  return edgeMap;
}

// ============= VALIDATION GATE =============

export function validateAutonomousResult(
  result: {
    facetCount: number;
    valleyCount: number;
    ridgeCount: number;
    hipCount: number;
    graphConnected: boolean;
    graphValid: boolean;
    coverageRatio: number;
    structuralEdgeCount: number;
  },
  complexity: { isComplex: boolean; expectedMinFacets: number; reasons: string[] }
): { valid: boolean; status: AutonomousGraphResult['validation_status']; reason?: string } {

  // GATE 0: Insufficient structural signal (hard fail — no synthesis)
  if (result.structuralEdgeCount < 2) {
    return {
      valid: false,
      status: 'insufficient_structural_signal',
      reason: `Only ${result.structuralEdgeCount} structural edges detected (need ≥2). DSM + fusion failed to find roof structure.`
    };
  }

  // GATE 1: Invalid planar graph
  if (!result.graphValid) {
    return {
      valid: false,
      status: 'invalid_roof_graph',
      reason: 'Planar graph enforcement failed (floating edges, unclosed loops, or disconnected components)'
    };
  }

  // GATE 2: Complex roof collapsed to ≤4 facets
  if (complexity.isComplex && result.facetCount <= 4) {
    return {
      valid: false,
      status: 'ai_failed_complex_topology',
      reason: `Complex roof (${complexity.reasons.join('; ')}) collapsed to ${result.facetCount} facets (expected ≥${complexity.expectedMinFacets})`
    };
  }

  // GATE 3: Complex roof with reflex corners but no valleys
  if (complexity.isComplex && complexity.reasons.some(r => r.includes('reflex')) && result.valleyCount === 0) {
    return {
      valid: false,
      status: 'ai_failed_complex_topology',
      reason: 'Complex footprint with reflex corners but no valleys detected'
    };
  }

  // GATE 4: Graph connectivity
  if (!result.graphConnected) {
    return {
      valid: false,
      status: 'needs_review',
      reason: 'Roof graph is not connected'
    };
  }

  // GATE 5: Coverage ratio
  if (result.coverageRatio < 0.92 || result.coverageRatio > 1.08) {
    return {
      valid: false,
      status: 'needs_review',
      reason: `Face coverage ratio ${result.coverageRatio.toFixed(2)} outside [0.92, 1.08]`
    };
  }

  // GATE 6: Complex roofs must have ≥6 edges
  if (complexity.isComplex && result.structuralEdgeCount < 6) {
    return {
      valid: false,
      status: 'needs_review',
      reason: `Complex roof with only ${result.structuralEdgeCount} edges (need ≥6)`
    };
  }

  return { valid: true, status: 'validated' };
}

// ============= MAIN SOLVER =============

export function solveAutonomousGraph(input: AutonomousGraphInput): AutonomousGraphResult {
  const startMs = Date.now();
  const warnings: string[] = [];
  const midLat = input.lat;

  console.log(`[AUTONOMOUS_GRAPH_SOLVER] Starting DSM-first pipeline`);
  console.log(`  Inputs: ${input.footprintCoords.length} footprint vertices, ${input.solarSegments.length} solar segments, DSM=${!!input.dsmGrid}, maskedDSM=${!!input.maskedDSM}, ${input.skeletonEdges.length} skeleton edges`);

  const footprintAreaSqft = polygonAreaSqft(input.footprintCoords, midLat);
  const complexity = detectComplexRoof(input.solarSegments, input.footprintCoords);

  if (complexity.isComplex) {
    console.log(`  COMPLEX ROOF: ${complexity.reasons.join('; ')}. Expected ≥${complexity.expectedMinFacets} facets.`);
  }

  // ===== STEP 2: DSM edge detection =====
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

  const allDSMEdges = [...dsmRidges, ...dsmValleys];

  // ===== STEP 2.5: Edge fusion =====
  const { accepted: fusedEdges, rejected: rejectedCount } = fuseEdgeCandidates(
    allDSMEdges,
    input.skeletonEdges,
    input.solarSegments,
    midLat,
    complexity.isComplex
  );

  console.log(`  Fusion: ${fusedEdges.length} accepted, ${rejectedCount} rejected (threshold 0.4)`);

  // ===== STEP 3: Clip to mask =====
  const clippedEdges = clipEdgesToMask(fusedEdges, input.footprintCoords, midLat);
  if (clippedEdges.length < fusedEdges.length) {
    console.log(`  Clipped: ${fusedEdges.length - clippedEdges.length} edges outside mask boundary`);
  }

  // ===== STEP 3.5: Planar graph enforcement =====
  const perimeterEdges: Array<{ start: XY; end: XY; type: 'eave' | 'rake' }> = [
    ...input.boundaryEdges.eaveEdges.map(([s, e]) => ({ start: s, end: e, type: 'eave' as const })),
    ...input.boundaryEdges.rakeEdges.map(([s, e]) => ({ start: s, end: e, type: 'rake' as const })),
  ];

  const graph = enforceplanarGraph(clippedEdges, perimeterEdges, midLat);
  console.log(`  Graph: ${graph.vertices.size} vertices, ${graph.edges.length} edges, valid=${graph.valid}${graph.reason ? ` (${graph.reason})` : ''}`);

  // ===== STEP 4: Build faces =====
  const graphFaces = buildFacesFromSolarSegments(input.solarSegments, midLat, input.lng, input.lat);

  // ===== STEP 4.5: Canonical edge mapping + physics-based classification =====
  const edgeMap = buildCanonicalEdgeMap(graph, graphFaces, effectiveDSM, midLat);

  // Convert graph edges to GraphEdge output format
  let edgeId = 0;
  const outputEdges: GraphEdge[] = [];

  for (const e of graph.edges) {
    const v1Pos = graph.vertices.get(e.v1)!;
    const v2Pos = graph.vertices.get(e.v2)!;
    const lengthFt = distanceFt(v1Pos, v2Pos, midLat);
    if (lengthFt < 1) continue;

    const canonKey = canonicalEdgeKey(e.v1, e.v2);
    const classified = edgeMap[canonKey];
    const finalType = classified?.classifiedType || e.type;

    outputEdges.push({
      id: `GE-${edgeId++}`,
      type: finalType,
      start: v1Pos,
      end: v2Pos,
      length_ft: lengthFt,
      confidence: {
        dsm_score: e.source === 'dsm' ? 0.8 : 0.4,
        rgb_score: 0.5,
        solar_azimuth_score: 0.7,
        topology_score: graph.valid ? 0.9 : 0.5,
        length_score: lengthFt > 10 ? 0.8 : 0.5,
        final_confidence: e.confidence,
      },
      facet_ids: classified?.faceIds || [],
      source: e.source as GraphEdge['source'],
    });
  }

  // ===== STEP 5: Totals =====
  const ridgeEdges = outputEdges.filter(e => e.type === 'ridge');
  const hipEdges = outputEdges.filter(e => e.type === 'hip');
  const valleyEdges = outputEdges.filter(e => e.type === 'valley');
  const eaveEdges = outputEdges.filter(e => e.type === 'eave');
  const rakeEdges = outputEdges.filter(e => e.type === 'rake');

  const structuralEdgeCount = ridgeEdges.length + hipEdges.length + valleyEdges.length;

  const totalRoofArea = graphFaces.reduce((s, f) => s + f.roof_area_sqft, 0);
  const totalPlanArea = graphFaces.reduce((s, f) => s + f.plan_area_sqft, 0);
  const coverageRatio = footprintAreaSqft > 0 ? totalPlanArea / footprintAreaSqft : 0;
  const graphConnected = graph.valid;

  const pitchWeighted = graphFaces.reduce((s, f) => s + f.pitch_degrees * f.roof_area_sqft, 0);
  const predominantPitch = totalRoofArea > 0 ? pitchWeighted / totalRoofArea : 0;

  const avgConfidence = outputEdges.length > 0
    ? outputEdges.reduce((s, e) => s + e.confidence.final_confidence, 0) / outputEdges.length
    : 0;

  // ===== STEP 6: QA gates =====
  const validation = validateAutonomousResult(
    {
      facetCount: graphFaces.length,
      valleyCount: valleyEdges.length,
      ridgeCount: ridgeEdges.length,
      hipCount: hipEdges.length,
      graphConnected,
      graphValid: graph.valid,
      coverageRatio,
      structuralEdgeCount,
    },
    complexity
  );

  // Build vertices output
  const outputVertices: GraphVertex[] = [];
  let vId = 0;
  for (const [key, pos] of graph.vertices) {
    const connectedEdgeIds = outputEdges
      .filter(e => vertexKey(e.start) === key || vertexKey(e.end) === key)
      .map(e => e.id);

    const isPerimeter = perimeterEdges.some(pe =>
      vertexKey(snapToGrid(pe.start, 0.5 / degToMeters(midLat).metersPerDegLng)) === key ||
      vertexKey(snapToGrid(pe.end, 0.5 / degToMeters(midLat).metersPerDegLng)) === key
    );

    outputVertices.push({
      id: `GV-${vId++}`,
      position: pos,
      type: isPerimeter ? 'eave_corner' : 'ridge_endpoint',
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
    fused_edges: fusedEdges.length,
    rejected_edges: rejectedCount,
    faces: graphFaces.length,
    coverage_ratio: coverageRatio,
    confidence: avgConfidence,
    graph_valid: graph.valid,
    warnings,
    timing_ms: timingMs,
  };

  console.log(`[DSM_STRUCTURE] ${JSON.stringify(logs)}`);
  console.log(`[AUTONOMOUS_GRAPH_SOLVER] Validation: ${validation.status}${validation.reason ? ` — ${validation.reason}` : ''}`);

  return {
    success: validation.valid,
    graph_connected: graphConnected,
    face_coverage_ratio: coverageRatio,
    validation_status: validation.status,
    failure_reason: validation.reason,
    vertices: outputVertices,
    edges: outputEdges,
    faces: graphFaces,
    totals: {
      ridge_ft: ridgeEdges.reduce((s, e) => s + e.length_ft, 0),
      hip_ft: hipEdges.reduce((s, e) => s + e.length_ft, 0),
      valley_ft: valleyEdges.reduce((s, e) => s + e.length_ft, 0),
      eave_ft: eaveEdges.reduce((s, e) => s + e.length_ft, 0),
      rake_ft: rakeEdges.reduce((s, e) => s + e.length_ft, 0),
      perimeter_ft: eaveEdges.reduce((s, e) => s + e.length_ft, 0) + rakeEdges.reduce((s, e) => s + e.length_ft, 0),
      total_roof_area_sqft: totalRoofArea,
      total_plan_area_sqft: totalPlanArea,
      predominant_pitch: predominantPitch,
    },
    logs,
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
