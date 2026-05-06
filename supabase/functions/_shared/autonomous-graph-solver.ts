/**
 * Autonomous Roof Graph Solver v8 — Pre-Masked DSM Edge Detection
 * 
 * Pipeline:
 *   1. DSM edge detection (Sobel gradient + PCA line fit)
 *   2. Edge scoring + filtering IN DSM PIXEL SPACE
 *   3. Conservative snapping (no center collapse)
 *   4. Edge clustering with span cap (weighted merge, max 60px)
 *   5. Prune over-intersected edges
 *   6. DSM physics classification (ridge/valley/hip)
 *   7. Planar graph with ordered intersection filtering
 *   8. Face clipping IN DSM PIXEL SPACE
 *   9. Conditional plane fit + pitch extraction from DSM
 *  10. Canonical edge mapping
 *  11. Consistency checks + coverage gate (≥85%)
 *
 * COORDINATE-SPACE CONTRACT (v5):
 *   - ALL geometric operations (containment, clipping, overlap, area
 *     conservation, shared edge tests) run in DSM pixel space.
 *   - Geo coordinates are used ONLY for persistence, export, and display.
 *   - Edge containment tests use DSM-pixel footprint.
 *   - Face clipping uses DSM-pixel footprint.
 *   - A coordinate-space assertion fires before every clipping operation.
 *
 * HARD RULES:
 *   - No legacy fallback. DSM graph is the only geometry source.
 *   - Coverage < 85% → FAIL (no fake roofs)
 *   - Hips > 50ft with 0 valleys → FAIL (invalid_roof_graph)
 *   - Always generate debug report regardless of pass/fail
 */

import type { DSMGrid, MaskedDSMGrid } from "./dsm-analyzer.ts";
import { geoToPixel, pixelToGeo, getElevationAt } from "./dsm-analyzer.ts";
import { detectStructuralEdges, type DSMEdgeCandidate } from "./dsm-edge-detector.ts";
import {
  classifyEdgeByDSM,
  getPerpendicularProfile,
  fitPlaneToPolygon,
  detectClosedPolygons,
  computeEdgeScore,
  edgeAngle,
  angleDifference,
} from "./dsm-utils.ts";
import { solveRoofPlanes as planarSolveRoofPlanes, type InteriorLine } from "./planar-roof-solver.ts";

type XY = [number, number]; // [lng, lat]
type PxPt = { x: number; y: number }; // DSM pixel space

import {
  EDGE_SCORE_THRESHOLD,
  SNAP_DISTANCE_METERS,
  SNAP_ANGLE_RAD,
  MIN_EDGE_LENGTH_FT,
  MAX_INTERSECTIONS_PER_EDGE,
  PLANE_FIT_ERROR_THRESHOLD,
  MIN_FACET_AREA_SQFT,
  MAX_INTERIOR_EDGES_FOR_SOLVER,
  MIN_EDGE_SCORE_FOR_SOLVER,
  CLUSTER_MIDPOINT_DIST_PX,
  CLUSTER_ANGLE_DEG,
  COVERAGE_RATIO_MIN,
} from "./solver-config.ts";

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
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'unclassified';
  start: XY;
  end: XY;
  length_ft: number;
  confidence: EdgeConfidence;
  facet_ids: string[];
  source: 'dsm' | 'solar_segments' | 'skeleton' | 'fused' | 'perimeter' | 'footprint';
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
  length_ft?: number;
  inside_footprint?: boolean;
  rejection_stage?: string;
}

export interface EnrichedFaceRejection {
  face_id: string;
  vertex_count: number;
  area_sqft: number;
  bbox_geo: { minX: number; minY: number; maxX: number; maxY: number } | null;
  centroid_geo: XY | null;
  inside_footprint: boolean;
  footprint_overlap_ratio: number | null;
  mask_overlap_ratio: number | null;
  plane_rms: number | null;
  pitch_degrees: number | null;
  shared_edge_count: number;
  boundary_edge_count: number;
  rejection_reasons: string[];
}

export interface EdgeRejectionSummary {
  total_raw: number;
  rejected_by_length: number;
  rejected_by_footprint: number;
  rejected_by_score: number;
  rejected_by_intersection: number;
  rejected_by_duplicate: number;
  rejected_by_connectivity: number;
  accepted_final: number;
  acceptance_ratio: number;
  edge_filter_over_aggressive: boolean;
}

export interface FaceClippingDiagnostics {
  face_bbox_solver: { minX: number; minY: number; maxX: number; maxY: number } | null;
  footprint_bbox_solver: { minX: number; minY: number; maxX: number; maxY: number } | null;
  bbox_overlap_ratio_before_clip: number;
  clipping_footprint_source: string;
  clipping_coordinate_space: string;
  coordinate_space_mismatch_detected: boolean;
  face_area_before_clip_px?: number;
  face_area_after_clip_px?: number;
  clip_operation_result?: string;
  footprint_winding?: string;
  face_winding?: string;
  polygon_self_intersection_detected?: boolean;
  // v7: clipper implementation debug
  clipper_algorithm?: string;
  clipper_input_face_vertices?: number;
  clipper_input_footprint_vertices?: number;
  clipper_output_vertices?: number;
  clipper_error?: string | null;
  vertices_inside_footprint?: number;
  vertices_outside_footprint?: number;
}

/**
 * Failure category — tells you WHERE in the pipeline the problem is.
 */
export type FailureCategory =
  | 'edge_filter_failure'
  | 'face_validation_failure'
  | 'polygon_clipper_failure'
  | 'partial_topology_success'
  | 'topology_collapse'
  | 'validated'
  | 'structural_signal_failure';

export interface DominantRejectionAnalysis {
  dominant_edge_rejection_reason: string | null;
  dominant_edge_rejection_count: number;
  dominant_edge_rejection_pct: number;
  dominant_face_rejection_reason: string | null;
  dominant_face_rejection_count: number;
  dominant_face_rejection_pct: number;
  edge_rejection_histogram: Record<string, number>;
  face_rejection_histogram: Record<string, number>;
}

export interface AutonomousGraphResult {
  success: boolean;
  graph_connected: boolean;
  face_coverage_ratio: number;
  validation_status: 'validated' | 'ai_failed_complex_topology' | 'faces_extracted_but_rejected' | 'invalid_edge_classification' | 'needs_review' | 'insufficient_structural_signal' | 'invalid_roof_graph' | 'dsm_edges_found_no_closed_faces' | 'incomplete_facet_coverage' | 'dsm_insufficient_resolution' | 'dsm_transform_invalid' | 'missing_valid_footprint' | 'footprint_coordinate_mismatch' | 'invalid_graph_no_perimeter' | 'graph_has_only_dangling_edges';
  failure_reason?: string;
  failure_category: FailureCategory;
  dominant_rejection: DominantRejectionAnalysis;
  
  vertices: GraphVertex[];
  edges: GraphEdge[];
  faces: GraphFace[];
  rejected_edges: RejectedEdgeDebug[];
  face_rejection_table?: Array<{ face_id: string; area_sqft: number; plane_rms: number | null; inside_footprint: boolean; mask_overlap: number | null; rejection_reason: string }>;
  enriched_face_rejections?: EnrichedFaceRejection[];
  edge_rejection_summary?: EdgeRejectionSummary;
  face_clipping_diagnostics?: FaceClippingDiagnostics[];
  bbox_rescue_used_for_display_only?: boolean;
  bbox_rescue_used_in_validation?: boolean;
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

  /** v5: Solver operates in DSM pixel space for all geometric ops */
  coordinate_space_solver: 'dsm_px';
  coordinate_space_export: 'geo';
  coordinate_space_footprint: 'dsm_px';

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
  faces_rejected_by_area: number;
  coverage_ratio: number;
  confidence: number;
  graph_valid: boolean;
  warnings: string[];
  timing_ms: number;
  dsm_edges_detected: number;
  dsm_edges_accepted: number;
  edge_count_after_cluster: number;
  interior_lines_used: number;
  graph_nodes: number;
  graph_segments: number;
  intersections_split: number;
  intersection_filter_skipped: number;
  cluster_merges: number;
  collinear_merges: number;
  fragment_merges: number;
  dangling_edges_removed: number;
  faces_extracted: number;
  face_count_before_merge: number;
  face_count_after_merge: number;
  valid_faces: number;
  attempted_area_total: number;
  attempted_face_count: number;
  attempted_edge_count: number;
  face_rejection_table?: Array<{ face_id: string; area_sqft: number; plane_rms: number | null; inside_footprint: boolean; mask_overlap: number | null; rejection_reason: string }>;
  edge_classification_debug?: Record<string, unknown>;
  pitch_source: string;
  dsm_mask_valid: boolean;
  topology_source: 'autonomous_dsm_graph_solver';
  facet_source: 'dsm_planar_graph_faces';
  hard_fail_reason?: string | null;
  customer_block_reason?: string | null;
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
  coordinateSpaceSolver?: 'dsm_px';
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

// ============= FOOTPRINT MASK RASTERIZATION =============

/**
 * Rasterize a footprint polygon (in DSM pixel space) into a Uint8Array mask.
 * Pixels inside the polygon (+ buffer px) are set to 1, others to 0.
 * This is used to constrain DSM edge detection to ONLY the roof region.
 *
 * Algorithm: scanline rasterization with optional dilation buffer.
 */
function rasterizeFootprintMask(
  footprintPx: PxPt[],
  width: number,
  height: number,
  bufferPx: number = 3
): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (footprintPx.length < 3) return mask;

  // Compute bounding box with buffer
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of footprintPx) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const startY = Math.max(0, Math.floor(minY) - bufferPx);
  const endY = Math.min(height - 1, Math.ceil(maxY) + bufferPx);
  const startX = Math.max(0, Math.floor(minX) - bufferPx);
  const endX = Math.min(width - 1, Math.ceil(maxX) + bufferPx);

  // Scanline fill: for each row, find intersections with polygon edges
  for (let y = startY; y <= endY; y++) {
    const intersections: number[] = [];
    const n = footprintPx.length;
    for (let i = 0; i < n; i++) {
      const a = footprintPx[i];
      const b = footprintPx[(i + 1) % n];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const xIntersect = a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x);
        intersections.push(xIntersect);
      }
    }
    intersections.sort((a, b) => a - b);
    
    // Fill between pairs of intersections
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const x1 = Math.max(startX, Math.floor(intersections[i]));
      const x2 = Math.min(endX, Math.ceil(intersections[i + 1]));
      for (let x = x1; x <= x2; x++) {
        mask[y * width + x] = 1;
      }
    }
  }

  // Dilate by bufferPx to include edges right at the footprint boundary
  if (bufferPx > 0) {
    const dilated = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x] === 1) {
          for (let dy = -bufferPx; dy <= bufferPx; dy++) {
            for (let dx = -bufferPx; dx <= bufferPx; dx++) {
              const ny = y + dy, nx = x + dx;
              if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                dilated[ny * width + nx] = 1;
              }
            }
          }
        }
      }
    }
    return dilated;
  }

  return mask;
}

/**
 * Intersect two masks: result[i] = 1 only if both a[i] and b[i] are 1.
 */
function intersectMasks(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = (a[i] && b[i]) ? 1 : 0;
  }
  return result;
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

/** Polygon area in pixel² (Shoelace formula) */
function polygonAreaPx(pts: PxPt[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(sum) / 2;
}

function midpoint(p1: XY, p2: XY): XY {
  return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}

function midpointPx(a: PxPt, b: PxPt): PxPt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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

/** Point-in-polygon for DSM pixel-space polygons */
function pointInPolygonPx(p: PxPt, ring: PxPt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y;
    const xj = ring[j].x, yj = ring[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Minimum distance from point to polygon boundary in px */
function minDistanceToPolygonBoundaryPx(p: PxPt, ring: PxPt[]): number {
  let minDist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    const proj = { x: a.x + abx * t, y: a.y + aby * t };
    const dist = Math.hypot(p.x - proj.x, p.y - proj.y);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function vertexKey(p: XY): string {
  return `${p[0].toFixed(8)},${p[1].toFixed(8)}`;
}

// ============= POLYGON WINDING & NORMALIZATION =============

/** Returns signed area: positive = CCW, negative = CW */
function signedAreaPx(pts: PxPt[]): number {
  let sum = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return sum / 2;
}

/** Ensure polygon is counter-clockwise */
function ensureCCW(pts: PxPt[]): PxPt[] {
  return signedAreaPx(pts) < 0 ? [...pts].reverse() : pts;
}

/** Detect self-intersection in a simple polygon (O(n²) but n is small) */
function detectSelfIntersection(pts: PxPt[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // Adjacent edges share a vertex
      const a1 = pts[i], a2 = pts[(i + 1) % n];
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (segmentsIntersectPx(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersectPx(a1: PxPt, a2: PxPt, b1: PxPt, b2: PxPt): boolean {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return false;
  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  const u = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

// ============= PIXEL-SPACE POLYGON CLIPPING (Concave-safe) =============

/**
 * Clip result with diagnostic info.
 */
interface ClipResult {
  polygon: PxPt[];
  method: 'inside_no_clip' | 'sutherland_hodgman' | 'vertex_filter' | 'clipper_degenerate_output' | 'empty';
  verticesInsideCount: number;
  verticesOutsideCount: number;
}

/**
 * Check if ALL vertices of subject are inside the clip polygon.
 * If yes, clipping is unnecessary — the face is fully contained.
 */
function allVerticesInside(subject: PxPt[], clip: PxPt[]): boolean {
  return subject.every(p => pointInPolygonPx(p, clip));
}

/**
 * Robust polygon clipping that handles concave clip polygons.
 * 
 * Strategy:
 * 1. If all subject vertices are inside clip → return subject unchanged
 * 2. Try vertex-filter approach: keep inside vertices + edge intersections
 * 3. Fallback to S-H only for convex clip polygons
 * 4. If result is degenerate (area < 5% of original), mark as clipper failure
 */
function clipPolygonPxRobust(subject: PxPt[], clip: PxPt[]): ClipResult {
  if (subject.length < 3 || clip.length < 3) {
    return { polygon: subject, method: 'empty', verticesInsideCount: 0, verticesOutsideCount: subject.length };
  }

  // Count vertices inside/outside
  const insideFlags = subject.map(p => pointInPolygonPx(p, clip));
  const insideCount = insideFlags.filter(Boolean).length;
  const outsideCount = subject.length - insideCount;

  // SHORTCUT: all inside → no clipping needed
  if (outsideCount === 0) {
    return { polygon: [...subject], method: 'inside_no_clip', verticesInsideCount: insideCount, verticesOutsideCount: 0 };
  }

  // For faces where most vertices are inside, use vertex-filter + edge intersection approach
  // This handles concave clip polygons correctly
  const clipped = clipByConcavePolygon(subject, clip, insideFlags);
  
  if (clipped.length >= 3) {
    const originalArea = polygonAreaPx(subject);
    const clippedArea = polygonAreaPx(clipped);
    
    // Sanity: if clipping destroyed > 95% of area, it's likely a clipper bug
    if (originalArea > 100 && clippedArea < originalArea * 0.05) {
      return { 
        polygon: clipped, 
        method: 'clipper_degenerate_output', 
        verticesInsideCount: insideCount, 
        verticesOutsideCount: outsideCount 
      };
    }
    
    return { polygon: clipped, method: 'vertex_filter', verticesInsideCount: insideCount, verticesOutsideCount: outsideCount };
  }

  return { polygon: [], method: 'empty', verticesInsideCount: insideCount, verticesOutsideCount: outsideCount };
}

/**
 * Clip a polygon by a potentially concave clip polygon.
 * Uses edge-by-edge intersection with point-in-polygon classification.
 * 
 * Algorithm:
 * Walk the subject polygon. For each edge:
 *   - If both endpoints inside: keep the end vertex
 *   - If entering (outside→inside): add intersection point + end vertex  
 *   - If leaving (inside→outside): add intersection point
 *   - If both outside: skip
 * 
 * Edge intersections are computed against ALL edges of the clip polygon,
 * taking the closest intersection. This handles concave clips correctly.
 */
function clipByConcavePolygon(subject: PxPt[], clip: PxPt[], insideFlags: boolean[]): PxPt[] {
  const result: PxPt[] = [];
  const n = subject.length;

  for (let i = 0; i < n; i++) {
    const curr = subject[i];
    const next = subject[(i + 1) % n];
    const currInside = insideFlags[i];
    const nextInside = insideFlags[(i + 1) % n];

    if (currInside && nextInside) {
      // Both inside: add next vertex
      result.push(next);
    } else if (currInside && !nextInside) {
      // Leaving: find exit intersection
      const ix = findClosestIntersectionWithPolygon(curr, next, clip, 'exit');
      if (ix) result.push(ix);
    } else if (!currInside && nextInside) {
      // Entering: find entry intersection + add next vertex
      const ix = findClosestIntersectionWithPolygon(curr, next, clip, 'entry');
      if (ix) result.push(ix);
      result.push(next);
    }
    // Both outside: skip
  }

  // Remove duplicate consecutive vertices
  return removeDuplicateVerticesPx(result);
}

/**
 * Find the closest intersection of segment (a→b) with the clip polygon boundary.
 * For 'exit': closest intersection going from inside to outside (smallest t > 0)
 * For 'entry': closest intersection going from outside to inside (largest t < 1, or smallest t for entry)
 */
function findClosestIntersectionWithPolygon(
  a: PxPt, b: PxPt, clip: PxPt[], direction: 'entry' | 'exit'
): PxPt | null {
  let bestT = direction === 'exit' ? Infinity : -Infinity;
  let bestPt: PxPt | null = null;

  for (let i = 0; i < clip.length; i++) {
    const c1 = clip[i];
    const c2 = clip[(i + 1) % clip.length];
    const ix = segmentSegmentIntersectionPx(a, b, c1, c2);
    if (!ix) continue;

    if (direction === 'exit') {
      // Want the first intersection along a→b (smallest t)
      if (ix.t < bestT && ix.t > 0.001) {
        bestT = ix.t;
        bestPt = ix.point;
      }
    } else {
      // Want the last intersection before reaching b (largest t < 1)
      if (ix.t > bestT && ix.t < 0.999) {
        bestT = ix.t;
        bestPt = ix.point;
      }
    }
  }

  return bestPt;
}

/**
 * Segment-segment intersection returning t parameter on first segment.
 */
function segmentSegmentIntersectionPx(
  a1: PxPt, a2: PxPt, b1: PxPt, b2: PxPt
): { point: PxPt; t: number; u: number } | null {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  const u = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;
  if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) return null;
  return {
    point: { x: a1.x + dx1 * t, y: a1.y + dy1 * t },
    t: Math.max(0, Math.min(1, t)),
    u: Math.max(0, Math.min(1, u)),
  };
}

/**
 * Remove consecutive duplicate vertices (within tolerance).
 */
function removeDuplicateVerticesPx(pts: PxPt[], tol = 0.5): PxPt[] {
  if (pts.length < 2) return pts;
  const result: PxPt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = result[result.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) > tol) {
      result.push(pts[i]);
    }
  }
  // Also check last vs first
  if (result.length > 1) {
    const first = result[0], last = result[result.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= tol) {
      result.pop();
    }
  }
  return result;
}

/** Legacy S-H clipper kept for reference but NOT used for concave polygons */
function clipPolygonPxSH(subject: PxPt[], clip: PxPt[]): PxPt[] {
  if (subject.length < 3 || clip.length < 3) return subject;
  let output = [...subject];
  for (let i = 0; i < clip.length; i++) {
    if (output.length < 3) return output;
    const edgeStart = clip[i];
    const edgeEnd = clip[(i + 1) % clip.length];
    const input = [...output];
    output = [];
    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];
      const currInside = crossProductPx(edgeStart, edgeEnd, current) >= -1e-6;
      const prevInside = crossProductPx(edgeStart, edgeEnd, previous) >= -1e-6;
      if (currInside) {
        if (!prevInside) {
          const ix = lineIntersectionPx(edgeStart, edgeEnd, previous, current);
          if (ix) output.push(ix);
        }
        output.push(current);
      } else if (prevInside) {
        const ix = lineIntersectionPx(edgeStart, edgeEnd, previous, current);
        if (ix) output.push(ix);
      }
    }
  }
  return output;
}

function crossProductPx(a: PxPt, b: PxPt, p: PxPt): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function lineIntersectionPx(a: PxPt, b: PxPt, c: PxPt, d: PxPt): PxPt | null {
  const dx1 = b.x - a.x, dy1 = b.y - a.y;
  const dx2 = d.x - c.x, dy2 = d.y - c.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((c.x - a.x) * dy2 - (c.y - a.y) * dx2) / denom;
  return { x: a.x + dx1 * t, y: a.y + dy1 * t };
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
  startPx: PxPt;
  endPx: PxPt;
  score: number;
  initialType: 'ridge' | 'valley' | 'hip';
  classifiedType: 'ridge' | 'valley' | 'hip' | 'eave' | 'rake' | 'unclassified';
  source: 'dsm' | 'skeleton' | 'fused';
  lengthFt: number;
}

// ============= STEP 1: SCORE & FILTER EDGES (PIXEL-SPACE CONTAINMENT) =============

function scoreAndFilterEdges(
  dsmEdges: DSMEdgeCandidate[],
  skeletonEdges: Array<{ start: XY; end: XY; type: 'ridge' | 'hip' | 'valley' }>,
  solarSegments: SolarSegment[],
  footprintGeo: XY[],
  footprintPx: PxPt[],
  dsmGrid: DSMGrid | null,
  midLat: number,
  isComplex: boolean
): { accepted: ScoredEdge[]; prunedByScore: number; rejectedDebug: RejectedEdgeDebug[]; rejectedByLength: number; rejectedByFootprint: number; totalRaw: number } {
  const candidates: ScoredEdge[] = [];
  let edgeIdx = 0;
  let skippedByLength = 0, skippedByFootprint = 0;

  const hasFootprintPx = footprintPx.length >= 3;

  if (dsmEdges.length > 0) {
    const sample = dsmEdges[0];
    console.log(`[EDGE_SCORING] DSM edge sample geo: start=[${sample.start[0].toFixed(6)}, ${sample.start[1].toFixed(6)}]`);
    console.log(`[EDGE_SCORING] DSM edge sample px: start=[${sample.startPx[0]}, ${sample.startPx[1]}]`);
  }
  if (footprintPx.length > 0) {
    console.log(`[EDGE_SCORING] Footprint px sample: [${footprintPx[0].x.toFixed(1)}, ${footprintPx[0].y.toFixed(1)}]`);
    console.log(`[EDGE_SCORING] Using RELAXED containment (v8 — edges already pre-masked to roof region)`);
  }

  // A. DSM edges — primary evidence.
  // v8: Edges are already pre-masked to roof region during detection.
  // Footprint containment is now a soft filter — accept if midpoint is inside
  // OR if any significant portion of the edge overlaps the footprint.
  for (const de of dsmEdges) {
    const lengthFt = distanceFt(de.start, de.end, midLat);
    if (lengthFt < MIN_EDGE_LENGTH_FT) { skippedByLength++; continue; }

    // Relaxed containment: since edge detection was pre-masked to roof region,
    // most edges are already valid. Only reject edges clearly outside footprint.
    if (hasFootprintPx) {
      const startPx: PxPt = { x: de.startPx[0], y: de.startPx[1] };
      const endPx: PxPt = { x: de.endPx[0], y: de.endPx[1] };
      const midPx = midpointPx(startPx, endPx);
      const startIn = pointInPolygonPx(startPx, footprintPx);
      const endIn = pointInPolygonPx(endPx, footprintPx);
      const midIn = pointInPolygonPx(midPx, footprintPx);
      
      // v8: Accept if midpoint inside OR any endpoint inside OR edge is near boundary
      if (midIn || startIn || endIn) {
        // pass — at least one point inside footprint
      } else {
        // Compute percent of edge length inside footprint by sampling
        const samples = 5;
        let insideSamples = 0;
        for (let s = 0; s <= samples; s++) {
          const t = s / samples;
          const sx = startPx.x + t * (endPx.x - startPx.x);
          const sy = startPx.y + t * (endPx.y - startPx.y);
          if (pointInPolygonPx({ x: sx, y: sy }, footprintPx)) insideSamples++;
        }
        const pctInsideMask = insideSamples / (samples + 1);
        
        // Accept if >=40% of edge is inside mask, or if very close to boundary
        if (pctInsideMask >= 0.40) {
          // pass — significant overlap with footprint
        } else {
          const distToFP = minDistanceToPolygonBoundaryPx(midPx, footprintPx);
          if (distToFP <= 8.0) {
            // Near-boundary edge — accept
          } else {
            skippedByFootprint++;
            continue;
          }
        }
      }
    } else {
      // Fallback: geo containment (should not happen with DSM grid)
      const mid = midpoint(de.start, de.end);
      if (!pointInPolygon(mid, footprintGeo) && !pointInPolygon(de.start, footprintGeo) && !pointInPolygon(de.end, footprintGeo)) {
        skippedByFootprint++;
        continue;
      }
    }

    const score = computeEdgeScore(de.start, de.end, de.dsm_score, dsmGrid, midLat);
    const startPx: PxPt = { x: de.startPx[0], y: de.startPx[1] };
    const endPx: PxPt = { x: de.endPx[0], y: de.endPx[1] };

    candidates.push({
      id: `SE-${edgeIdx++}`,
      start: de.start,
      end: de.end,
      startPx,
      endPx,
      score,
      initialType: de.type,
      classifiedType: de.type,
      source: 'dsm',
      lengthFt,
    });
  }

  console.log(`[EDGE_SCORING] DSM edges: ${dsmEdges.length} total, ${skippedByLength} too short, ${skippedByFootprint} outside footprint, ${candidates.length} candidates`);

  // B. Skeleton edges — only for simple roofs
  if (!isComplex && dsmGrid) {
    for (const skel of skeletonEdges) {
      const lengthFt = distanceFt(skel.start, skel.end, midLat);
      if (lengthFt < MIN_EDGE_LENGTH_FT) continue;

      const skelMidGeo = midpoint(skel.start, skel.end);
      
      const isDuplicate = candidates.some(c =>
        distanceMeters(midpoint(c.start, c.end), skelMidGeo, midLat) < 5
      );
      if (isDuplicate) continue;

      const score = computeEdgeScore(skel.start, skel.end, 0.3, dsmGrid, midLat);
      const sPx = geoToPxPoint(skel.start, dsmGrid);
      const ePx = geoToPxPoint(skel.end, dsmGrid);

      candidates.push({
        id: `SE-${edgeIdx++}`,
        start: skel.start,
        end: skel.end,
        startPx: sPx,
        endPx: ePx,
        score: score * 0.7,
        initialType: skel.type,
        classifiedType: skel.type,
        source: 'skeleton',
        lengthFt,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

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
    length_ft: c.lengthFt,
    inside_footprint: true,
    rejection_stage: 'score_filter',
  }));

  const totalRaw = dsmEdges.length + skeletonEdges.length;
  return { accepted, prunedByScore, rejectedDebug, rejectedByLength: skippedByLength, rejectedByFootprint: skippedByFootprint, totalRaw };
}

// ============= STEP 2: CONSERVATIVE SNAPPING (NO CENTER COLLAPSE) =============

function conservativeSnap(
  edges: ScoredEdge[],
  perimeterVertices: XY[],
  midLat: number
): ScoredEdge[] {
  const anchors: XY[] = [...perimeterVertices];
  const topEdges = edges.slice(0, Math.min(edges.length, 5));
  for (const e of topEdges) {
    anchors.push(e.start, e.end);
  }

  return edges.map(edge => {
    let start = edge.start;
    let end = edge.end;
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

  for (const other of allEdges) {
    if (other.id === ownerEdge.id) continue;
    for (const otherPt of [other.start, other.end]) {
      const dist = distanceMeters(point, otherPt, midLat);
      if (dist >= SNAP_DISTANCE_METERS) continue;
      const ownerAngle = edgeAngle(ownerEdge.start, ownerEdge.end);
      const otherAngle = edgeAngle(other.start, other.end);
      const aDiff = angleDifference(ownerAngle, otherAngle);
      if (aDiff < SNAP_ANGLE_RAD) continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = otherPt;
      }
    }
  }

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

  if (t < 0.05 || t > 0.95 || u < 0.05 || u > 0.95) return null;

  return [a1[0] + t * dx1, a1[1] + t * dy1];
}

// ============= STEP 4: DSM PHYSICS CLASSIFICATION =============

function classifyEdgesWithDSMDebug(edges: ScoredEdge[], dsmGrid: DSMGrid | null): { edges: ScoredEdge[]; debug: Record<string, unknown> } {
  if (!dsmGrid) return { edges, debug: { skipped: true, reason: 'dsm_missing' } };
  const samples = edges.map((edge) => {
    const profile = getPerpendicularProfile(edge.start, edge.end, dsmGrid, 7, 3, 3);
    const classified = classifyEdgeByDSM(edge.start, edge.end, dsmGrid);
    return {
      edge_id: edge.id,
      initial_type: edge.initialType,
      classified_type: classified || edge.classifiedType,
      sample_count: profile.sampleCount,
      left_slope: Number(profile.leftSlope.toFixed(3)),
      right_slope: Number(profile.rightSlope.toFixed(3)),
      center_avg: Number(profile.centerAvg.toFixed(3)),
      height_delta: Number(profile.heightDelta.toFixed(3)),
    };
  });
  return {
    edges: edges.map((edge, idx) => ({ ...edge, classifiedType: (samples[idx].classified_type as ScoredEdge['classifiedType']) || edge.classifiedType })),
    debug: {
      rule: 'ridge=both_sides_down,valley=both_sides_up,hip=mixed_descending_planes,eave_rake=footprint_boundary',
      samples,
      counts: samples.reduce((acc: Record<string, number>, s) => {
        const key = String(s.classified_type || 'unknown');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    },
  };
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

  for (const e of structuralEdges) {
    const v1 = addVertex(e.start);
    const v2 = addVertex(e.end);
    if (v1 === v2) continue;
    const exists = edges.some(ex => (ex.v1 === v1 && ex.v2 === v2) || (ex.v1 === v2 && ex.v2 === v1));
    if (!exists) {
      edges.push({ v1, v2, type: e.classifiedType, score: e.score, source: e.source });
    }
  }

  for (const e of perimeterEdges) {
    const v1 = addVertex(e.start);
    const v2 = addVertex(e.end);
    if (v1 === v2) continue;
    const exists = edges.some(ex => (ex.v1 === v1 && ex.v2 === v2) || (ex.v1 === v2 && ex.v2 === v1));
    if (!exists) {
      edges.push({ v1, v2, type: e.type, score: 0.85, source: 'perimeter' });
    }
  }

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
  const graphEdgesForPoly = graph.edges.map((e, i) => ({ v1: e.v1, v2: e.v2, id: `ge-${i}` }));
  const polygonVertexKeys = detectClosedPolygons(graphEdgesForPoly, graph.vertices);

  const faces: GraphFace[] = [];
  let rejectedCount = 0;
  let faceIdx = 0;

  for (const vertexKeys of polygonVertexKeys) {
    const polygon = vertexKeys.map(k => graph.vertices.get(k)!).filter(Boolean);
    if (polygon.length < 3) continue;

    const areaSqft = polygonAreaSqft(polygon, midLat);
    if (areaSqft < MIN_FACET_AREA_SQFT) {
      rejectedCount++;
      continue;
    }

    if (dsmGrid) {
      const fitError = fitPlaneToPolygon(polygon, dsmGrid);
      if (fitError !== null && fitError > PLANE_FIT_ERROR_THRESHOLD) {
        rejectedCount++;
        console.log(`  Facet rejected: plane fit error ${fitError.toFixed(3)}m > ${PLANE_FIT_ERROR_THRESHOLD}m`);
        continue;
      }
    }

    const facetCenter = polygon.reduce((acc, p) => [acc[0] + p[0] / polygon.length, acc[1] + p[1] / polygon.length] as XY, [0, 0] as XY);
    const matchingSolar = findClosestSolarSegment(facetCenter, solarSegments);
    const pitch = matchingSolar?.pitchDegrees || 0;
    const azimuth = matchingSolar?.azimuthDegrees || 0;

    const label = String.fromCharCode(65 + faceIdx);
    const closedPolygon = [...polygon, polygon[0]];

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

function geoToPxPoint(p: XY, grid: DSMGrid): PxPt {
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

// ============= EDGE CLUSTERING (WEIGHTED MERGE WITH SPAN CAP) =============

const CLUSTER_MAX_SPAN_PX = 80;

interface ClusterableEdge {
  a: { x: number; y: number };
  b: { x: number; y: number };
  type: 'ridge' | 'valley' | 'hip';
  score: number;
}

function clusterEdges(edges: ClusterableEdge[]): ClusterableEdge[] {
  if (edges.length <= 1) return edges;
  
  const used = new Set<number>();
  const result: ClusterableEdge[] = [];

  for (let i = 0; i < edges.length; i++) {
    if (used.has(i)) continue;
    
    const cluster = [i];
    used.add(i);

    for (let j = i + 1; j < edges.length; j++) {
      if (used.has(j)) continue;
      
      let belongs = false;
      for (const ci of cluster) {
        const ei = edges[ci];
        const ej = edges[j];
        
        const ai = Math.atan2(ei.b.y - ei.a.y, ei.b.x - ei.a.x);
        const aj = Math.atan2(ej.b.y - ej.a.y, ej.b.x - ej.a.x);
        let angleDiff = Math.abs(ai - aj);
        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
        if (angleDiff > Math.PI / 2) angleDiff = Math.PI - angleDiff;
        if (angleDiff * 180 / Math.PI > CLUSTER_ANGLE_DEG) continue;
        
        const midI = { x: (ei.a.x + ei.b.x) / 2, y: (ei.a.y + ei.b.y) / 2 };
        const midJ = { x: (ej.a.x + ej.b.x) / 2, y: (ej.a.y + ej.b.y) / 2 };
        const midDist = Math.hypot(midI.x - midJ.x, midI.y - midJ.y);
        if (midDist > CLUSTER_MIDPOINT_DIST_PX) continue;
        
        belongs = true;
        break;
      }
      
      if (belongs) {
        cluster.push(j);
        used.add(j);
      }
    }

    if (cluster.length === 1) {
      result.push(edges[i]);
      continue;
    }

    const clusterEdgesArr = cluster.map(ci => edges[ci]);
    const allPts = clusterEdgesArr.flatMap(e => [e.a, e.b]);
    const spanX = Math.max(...allPts.map(p => p.x)) - Math.min(...allPts.map(p => p.x));
    const spanY = Math.max(...allPts.map(p => p.y)) - Math.min(...allPts.map(p => p.y));
    const span = Math.hypot(spanX, spanY);
    
    if (span > CLUSTER_MAX_SPAN_PX && clusterEdgesArr.length > 2) {
      clusterEdgesArr.sort((a, b) => b.score - a.score);
      result.push(clusterEdgesArr[0], clusterEdgesArr[1]);
      continue;
    }
    
    let totalWeight = 0;
    let avgDx = 0, avgDy = 0;
    for (const e of clusterEdgesArr) {
      const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      const dx = (e.b.x - e.a.x) / (len || 1);
      const dy = (e.b.y - e.a.y) / (len || 1);
      const sign = (avgDx * dx + avgDy * dy >= 0 || totalWeight === 0) ? 1 : -1;
      avgDx += sign * dx * len;
      avgDy += sign * dy * len;
      totalWeight += len;
    }
    const normLen = Math.hypot(avgDx, avgDy) || 1;
    const nx = avgDx / normLen, ny = avgDy / normLen;
    
    const cx = allPts.reduce((s, p) => s + p.x, 0) / allPts.length;
    const cy = allPts.reduce((s, p) => s + p.y, 0) / allPts.length;
    const projections = allPts.map(p => (p.x - cx) * nx + (p.y - cy) * ny);
    const minProj = Math.min(...projections);
    const maxProj = Math.max(...projections);
    
    const bestScore = Math.max(...clusterEdgesArr.map(e => e.score));
    const typePriority: Record<string, number> = { ridge: 3, valley: 3, hip: 2 };
    const bestType = clusterEdgesArr.reduce((best, e) => 
      (typePriority[e.type] || 0) > (typePriority[best.type] || 0) ? e : best
    ).type;
    
    result.push({
      a: { x: Math.round(cx + nx * minProj), y: Math.round(cy + ny * minProj) },
      b: { x: Math.round(cx + nx * maxProj), y: Math.round(cy + ny * maxProj) },
      type: bestType,
      score: bestScore,
    });
  }

  return result;
}

// ============= DSM PLANE FIT WITH PITCH/AZIMUTH =============

function fitPlaneWithPitch(
  polygon: XY[],
  dsmGrid: DSMGrid,
): { rms: number; pitchDeg: number; azimuthDeg: number } | null {
  if (polygon.length < 3) return null;
  
  const { bounds, width, height, data, noDataValue } = dsmGrid;
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const metersPerPixelX = (bounds.maxLng - bounds.minLng) / width * 111320 * Math.cos(midLat * Math.PI / 180);
  const metersPerPixelY = (bounds.maxLat - bounds.minLat) / height * 111320;
  
  const minPxX = Math.max(0, Math.floor((Math.min(...polygon.map(p => p[0])) - bounds.minLng) / (bounds.maxLng - bounds.minLng) * width));
  const maxPxX = Math.min(width - 1, Math.ceil((Math.max(...polygon.map(p => p[0])) - bounds.minLng) / (bounds.maxLng - bounds.minLng) * width));
  const minPxY = Math.max(0, Math.floor((bounds.maxLat - Math.max(...polygon.map(p => p[1]))) / (bounds.maxLat - bounds.minLat) * height));
  const maxPxY = Math.min(height - 1, Math.ceil((bounds.maxLat - Math.min(...polygon.map(p => p[1]))) / (bounds.maxLat - bounds.minLat) * height));

  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let py = minPxY; py <= maxPxY; py++) {
    for (let px = minPxX; px <= maxPxX; px++) {
      const lng = bounds.minLng + ((px + 0.5) / width) * (bounds.maxLng - bounds.minLng);
      const lat = bounds.maxLat - ((py + 0.5) / height) * (bounds.maxLat - bounds.minLat);
      if (!pointInPolygon([lng, lat], polygon)) continue;
      const z = data[py * width + px];
      if (z === noDataValue || isNaN(z)) continue;
      points.push({ x: px, y: py, z });
    }
  }

  if (points.length < 6) return null;

  const N = points.length;
  let Sx = 0, Sy = 0, Sz = 0, Sxx = 0, Sxy = 0, Syy = 0, Sxz = 0, Syz = 0;
  for (const p of points) {
    Sx += p.x; Sy += p.y; Sz += p.z;
    Sxx += p.x * p.x; Sxy += p.x * p.y; Syy += p.y * p.y;
    Sxz += p.x * p.z; Syz += p.y * p.z;
  }

  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, N]];
  const B = [Sxz, Syz, Sz];
  const det = det3(A);
  if (Math.abs(det) < 1e-10) return null;

  const a = det3(replCol(A, B, 0)) / det;
  const b = det3(replCol(A, B, 1)) / det;
  const c = det3(replCol(A, B, 2)) / det;

  let sumSqErr = 0;
  for (const p of points) {
    const err = p.z - (a * p.x + b * p.y + c);
    sumSqErr += err * err;
  }
  const rms = Math.sqrt(sumSqErr / N);

  const slopeX = a / metersPerPixelX;
  const slopeY = b / metersPerPixelY;
  const gradMag = Math.sqrt(slopeX * slopeX + slopeY * slopeY);
  let pitchDeg = Math.atan(gradMag) * 180 / Math.PI;
  const MAX_RESIDENTIAL_PITCH_DEG = 63;
  if (pitchDeg > MAX_RESIDENTIAL_PITCH_DEG) {
    console.warn(`[FIT_PLANE] Clamping unrealistic pitch ${pitchDeg.toFixed(1)}° → ${MAX_RESIDENTIAL_PITCH_DEG}° (likely wall/noise)`);
    pitchDeg = MAX_RESIDENTIAL_PITCH_DEG;
  }
  const azimuthDeg = ((Math.atan2(slopeX, -slopeY) * 180 / Math.PI) + 360) % 360;

  return { rms, pitchDeg, azimuthDeg };
}

function det3(m: number[][]): number {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
         m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
         m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

function replCol(m: number[][], b: number[], col: number): number[][] {
  return m.map((row, i) => row.map((val, j) => j === col ? b[i] : val));
}

// ============= VALIDATION GATE =============

export function validateAutonomousResult(
  result: {
    facetCount: number;
    valleyCount: number;
    ridgeCount: number;
    hipCount: number;
    hipFt: number;
    graphConnected: boolean;
    coverageRatio: number;
    structuralEdgeCount: number;
    dsmEdgesAccepted: number;
  },
  complexity: { isComplex: boolean; expectedMinFacets: number; reasons: string[] }
): { valid: boolean; status: AutonomousGraphResult['validation_status']; reason?: string } {

  if (result.dsmEdgesAccepted >= 5 && result.facetCount < 2) {
    return {
      valid: false,
      status: 'dsm_edges_found_no_closed_faces',
      reason: `${result.dsmEdgesAccepted} accepted DSM structural edges found, but planar graph extracted only ${result.facetCount} valid faces`
    };
  }

  if (result.structuralEdgeCount < 2) {
    return {
      valid: false,
      status: 'insufficient_structural_signal',
      reason: `Only ${result.structuralEdgeCount} structural edges survived scoring (need ≥2). DSM signal too weak.`
    };
  }

  if (result.ridgeCount === 0 && result.hipCount === 0) {
    return {
      valid: false,
      status: 'invalid_roof_graph',
      reason: 'No ridges or hips detected — cannot form a valid roof structure'
    };
  }

  if (complexity.isComplex && result.facetCount <= 4) {
    return {
      valid: false,
      status: 'ai_failed_complex_topology',
      reason: `Complex roof (${complexity.reasons.join('; ')}) produced only ${result.facetCount} facets (expected ≥${complexity.expectedMinFacets})`
    };
  }

  if (complexity.isComplex && complexity.reasons.some(r => r.includes('reflex')) && result.valleyCount === 0) {
    return {
      valid: false,
      status: 'ai_failed_complex_topology',
      reason: 'Complex footprint with reflex corners but no valleys detected — physically impossible'
    };
  }

  if (result.facetCount < 2) {
    return {
      valid: false,
      status: 'invalid_roof_graph',
      reason: `Only ${result.facetCount} valid facets — need ≥2 for a roof`
    };
  }

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

  if (result.hipFt > 50 && result.valleyCount === 0 && result.ridgeCount === 0) {
    return {
      valid: false,
      status: 'invalid_roof_graph',
      reason: `${result.hipFt.toFixed(0)}ft of hip edges but 0 valleys and 0 ridges — physically inconsistent`
    };
  }

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
  let edgeCountAfterCluster = 0;
  let faceCountBeforeMerge = 0;
  let faceCountAfterMerge = 0;
  const dsmMaskValid = input.maskedDSM?.mask ? !input.maskedDSM.mask.every(v => v === 1) : false;

  console.log(`[AUTONOMOUS_GRAPH_SOLVER] v8 — Pre-Masked DSM Edge Detection`);
  console.log(`  Inputs: ${input.footprintCoords.length} footprint vertices, ${input.solarSegments.length} solar segments, DSM=${!!input.dsmGrid}, maskedDSM=${!!input.maskedDSM}, ${input.skeletonEdges.length} skeleton edges`);

  const footprintAreaSqft = polygonAreaSqft(input.footprintCoords, midLat);
  const complexity = detectComplexRoof(input.solarSegments, input.footprintCoords);

  if (complexity.isComplex) {
    console.log(`  COMPLEX ROOF: ${complexity.reasons.join('; ')}. Expected ≥${complexity.expectedMinFacets} facets.`);
  }

  // ===== CONVERT FOOTPRINT TO DSM PIXEL SPACE =====
  const effectiveDSM = input.maskedDSM || input.dsmGrid;
  const footprintPx: PxPt[] = effectiveDSM
    ? input.footprintCoords.map((p) => geoToPxPoint(p, effectiveDSM))
    : [];
  
  // Normalize footprint winding to CCW for clipping
  const footprintPxCCW = footprintPx.length >= 3 ? ensureCCW(footprintPx) : footprintPx;
  const footprintWinding = footprintPx.length >= 3 ? (signedAreaPx(footprintPx) >= 0 ? 'CCW' : 'CW') : 'unknown';
  const footprintSelfIntersects = footprintPx.length >= 3 ? detectSelfIntersection(footprintPx) : false;
  const footprintAreaPxVal = polygonAreaPx(footprintPxCCW);

  console.log(`  Footprint px: ${footprintPx.length} vertices, winding=${footprintWinding}, self_intersects=${footprintSelfIntersects}, area_px=${footprintAreaPxVal.toFixed(0)}`);

  if (footprintSelfIntersects) {
    warnings.push('footprint_self_intersection_detected');
  }

  // ===== STEP 1: PRE-MASKED DSM EDGE DETECTION (v8) =====
  // Architecture: constrain edge detection to roof region BEFORE topology,
  // not afterward. Rasterize footprint polygon into a pixel mask and pass it
  // to the edge detector so only roof-region pixels produce structural edges.
  let dsmRidges: DSMEdgeCandidate[] = [];
  let dsmValleys: DSMEdgeCandidate[] = [];
  let unmaskEdgeCount = 0;
  let maskedEdgeCount = 0;
  let roofMaskPixelCount = 0;

  if (effectiveDSM) {
    const { width, height } = effectiveDSM;

    // Build roof-region mask from footprint polygon (3px buffer for boundary edges)
    const footprintMask = footprintPxCCW.length >= 3
      ? rasterizeFootprintMask(footprintPxCCW, width, height, 3)
      : null;

    // Intersect with existing DSM mask (if any) so we don't scan noData regions
    const existingMask = input.maskedDSM?.mask || null;
    let roofMask: Uint8Array | null;
    if (footprintMask && existingMask) {
      roofMask = intersectMasks(footprintMask, existingMask);
    } else {
      roofMask = footprintMask || existingMask;
    }

    // Count mask pixels for diagnostics
    if (roofMask) {
      for (let i = 0; i < roofMask.length; i++) {
        if (roofMask[i]) roofMaskPixelCount++;
      }
    }

    // Run edge detection ONLY inside roof mask
    const detection = detectStructuralEdges(effectiveDSM, roofMask);
    dsmRidges = detection.ridges;
    dsmValleys = detection.valleys;
    maskedEdgeCount = dsmRidges.length + dsmValleys.length;

    console.log(`  [v8 PRE-MASK] Roof mask: ${roofMaskPixelCount} pixels out of ${width * height} total (${(roofMaskPixelCount / (width * height) * 100).toFixed(1)}%)`);
    console.log(`  DSM edges (pre-masked): ${dsmRidges.length} ridges, ${dsmValleys.length} valleys (${detection.stats.processingMs}ms)`);
  } else {
    warnings.push('DSM not available — structural detection limited to skeleton');
  }

  // ===== STEP 2: Score & filter (PIXEL-SPACE CONTAINMENT) =====
  const { accepted: scoredEdges, prunedByScore, rejectedDebug: rejectedEdgesDebug, rejectedByLength, rejectedByFootprint, totalRaw } = scoreAndFilterEdges(
    [...dsmRidges, ...dsmValleys],
    input.skeletonEdges,
    input.solarSegments,
    input.footprintCoords,
    footprintPxCCW,
    effectiveDSM,
    midLat,
    complexity.isComplex
  );

  const edgeAcceptanceRatio = totalRaw > 0 ? scoredEdges.length / totalRaw : 0;
  const edgeFilterOverAggressive = edgeAcceptanceRatio < 0.25 && totalRaw > 10;
  if (edgeFilterOverAggressive) {
    warnings.push(`edge_filter_over_aggressive: acceptance_ratio=${edgeAcceptanceRatio.toFixed(3)} (${scoredEdges.length}/${totalRaw})`);
  }

  console.log(`  Scoring: ${scoredEdges.length} accepted, ${prunedByScore} pruned by score (threshold ${EDGE_SCORE_THRESHOLD}), acceptance_ratio=${edgeAcceptanceRatio.toFixed(3)}`);

  // ===== STEP 3: Conservative snapping =====
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
  const classificationResult = classifyEdgesWithDSMDebug(cleanEdges, effectiveDSM);
  const classifiedEdges = classificationResult.edges;
  const edgeClassificationDebug = classificationResult.debug;

  const ridgeCount = classifiedEdges.filter(e => e.classifiedType === 'ridge').length;
  const valleyCount = classifiedEdges.filter(e => e.classifiedType === 'valley').length;
  const hipCount = classifiedEdges.filter(e => e.classifiedType === 'hip').length;
  console.log(`  DSM classification: ${ridgeCount} ridges, ${valleyCount} valleys, ${hipCount} hips`);

  // ===== STEP 6: Edge clustering =====
  const rawDsmInteriorEdgesPx = effectiveDSM
    ? classifiedEdges
        .filter((e) => e.source === 'dsm' && (e.classifiedType === 'ridge' || e.classifiedType === 'hip' || e.classifiedType === 'valley'))
        .map((e) => ({
          a: geoToPxPoint(e.start, effectiveDSM),
          b: geoToPxPoint(e.end, effectiveDSM),
          type: e.classifiedType as 'ridge' | 'valley' | 'hip',
          score: e.score,
        }))
    : [];
  
  const clusteredEdgesPx = clusterEdges(rawDsmInteriorEdgesPx);
  edgeCountAfterCluster = clusteredEdgesPx.length;
  console.log(`  Edge clustering: ${rawDsmInteriorEdgesPx.length} → ${clusteredEdgesPx.length} edges`);

  // ===== STEP 6b: Cap interior edges =====
  let dsmInteriorEdgesPx = clusteredEdgesPx
    .filter((e) => e.score >= MIN_EDGE_SCORE_FOR_SOLVER);
  if (dsmInteriorEdgesPx.length > MAX_INTERIOR_EDGES_FOR_SOLVER) {
    dsmInteriorEdgesPx.sort((a, b) => {
      const lenA = Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y);
      const lenB = Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y);
      return (b.score * lenB) - (a.score * lenA);
    });
    dsmInteriorEdgesPx = dsmInteriorEdgesPx.slice(0, MAX_INTERIOR_EDGES_FOR_SOLVER);
  }
  console.log(`  Edge cap: ${clusteredEdgesPx.length} → ${dsmInteriorEdgesPx.length} edges (max ${MAX_INTERIOR_EDGES_FOR_SOLVER})`);

  // ===== STEP 7: Planar graph with ordered intersection filtering =====
  const planarInput: InteriorLine[] = dsmInteriorEdgesPx.map(e => ({
    a: e.a, b: e.b, type: e.type, score: e.score,
  }));
  const planar = effectiveDSM && footprintPxCCW.length >= 3
    ? planarSolveRoofPlanes(footprintPxCCW, planarInput)
    : { faces: [], edges: [], debug: { input_footprint_vertices: 0, input_interior_lines: 0, snapped_interior_lines: 0, collinear_merges: 0, filtered_by_priority: 0, intersections_split: 0, dangling_edges_removed: 0, perimeter_reinjected: 0, total_graph_segments: 0, total_graph_nodes: 0, faces_extracted: 0, faces_with_area: 0, face_coverage_ratio: 0 } };
  console.log(`  DSM planar graph: ${planar.debug.total_graph_nodes} nodes, ${planar.debug.total_graph_segments} segments, ${planar.faces.length} valid faces, coverage=${planar.debug.face_coverage_ratio}`);

  let facesRejected = 0;
  const faceRejectionTable: NonNullable<AutonomousGraphResult['face_rejection_table']> = [];
  const enrichedFaceRejections: EnrichedFaceRejection[] = [];
  const faceClippingDiagnostics: FaceClippingDiagnostics[] = [];
  const graphFaces: GraphFace[] = [];
  faceCountBeforeMerge = planar.faces.length;

  // Compute footprint bbox in pixel space for diagnostics
  const footprintBboxPx = footprintPxCCW.length >= 3 ? getBoundsPx(footprintPxCCW) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  // ===== FACE PROCESSING: CLIP IN PIXEL SPACE, THEN CONVERT TO GEO =====
  for (const [faceIdx, face] of planar.faces.entries()) {
    const faceId = `attempt-${faceIdx + 1}`;
    const rejectionReasons: string[] = [];

    // Face polygon is already in pixel space from planar solver
    let facePx = face.polygon.map(p => ({ x: p.x, y: p.y }));
    if (facePx.length < 3) continue;

    // Normalize face winding to CCW
    const faceWindingStr = signedAreaPx(facePx) >= 0 ? 'CCW' : 'CW';
    facePx = ensureCCW(facePx);
    const faceSelfIntersects = detectSelfIntersection(facePx);

    // Pre-clip diagnostics in pixel space
    const faceBboxPx = getBoundsPx(facePx);
    const faceAreaBeforeClipPx = polygonAreaPx(facePx);

    // Pixel-space bbox overlap
    const overlapX = Math.max(0, Math.min(faceBboxPx.maxX, footprintBboxPx.maxX) - Math.max(faceBboxPx.minX, footprintBboxPx.minX));
    const overlapY = Math.max(0, Math.min(faceBboxPx.maxY, footprintBboxPx.maxY) - Math.max(faceBboxPx.minY, footprintBboxPx.minY));
    const faceBboxAreaPx = Math.max((faceBboxPx.maxX - faceBboxPx.minX) * (faceBboxPx.maxY - faceBboxPx.minY), 1e-6);
    const bboxOverlapBeforeClip = (overlapX * overlapY) / faceBboxAreaPx;

    const clipDiag: FaceClippingDiagnostics = {
      face_bbox_solver: faceBboxPx,
      footprint_bbox_solver: footprintBboxPx,
      bbox_overlap_ratio_before_clip: Number(bboxOverlapBeforeClip.toFixed(3)),
      clipping_footprint_source: 'footprint_dsm_px',
      clipping_coordinate_space: 'dsm_px',
      coordinate_space_mismatch_detected: false, // Both are now in px!
      face_area_before_clip_px: Number(faceAreaBeforeClipPx.toFixed(1)),
      footprint_winding: footprintWinding,
      face_winding: faceWindingStr,
      polygon_self_intersection_detected: faceSelfIntersects,
    };

    if (faceSelfIntersects) {
      rejectionReasons.push('face_polygon_self_intersecting');
      warnings.push(`face_${faceId}_self_intersecting`);
    }

    // ===== PIXEL-SPACE CLIPPING (Concave-safe v6) =====
    // Clean face polygon before clipping
    const cleanedFacePx = removeDuplicateVerticesPx(facePx, 0.5);
    
    const clipResult = clipPolygonPxRobust(
      cleanedFacePx.length >= 3 ? cleanedFacePx : facePx, 
      footprintPxCCW
    );
    const clippedPx = clipResult.polygon;
    const faceAreaAfterClipPx = polygonAreaPx(clippedPx);
    clipDiag.face_area_after_clip_px = Number(faceAreaAfterClipPx.toFixed(1));
    clipDiag.clip_operation_result = clipResult.method === 'inside_no_clip' 
      ? 'inside_no_clip'
      : clipResult.method === 'clipper_degenerate_output'
      ? 'clipper_degenerate_output'
      : clippedPx.length < 3 
      ? 'clipped_to_nothing' 
      : `${clippedPx.length}_vertices_${clipResult.method}`;
    clipDiag.clipper_algorithm = clipResult.method;
    clipDiag.clipper_input_face_vertices = (cleanedFacePx.length >= 3 ? cleanedFacePx : facePx).length;
    clipDiag.clipper_input_footprint_vertices = footprintPxCCW.length;
    clipDiag.clipper_output_vertices = clippedPx.length;
    clipDiag.clipper_error = clipResult.method === 'clipper_degenerate_output' ? 'degenerate_output_area_destroyed' : (clippedPx.length < 3 && faceAreaBeforeClipPx > 100 ? 'clipped_to_nothing' : null);
    clipDiag.vertices_inside_footprint = clipResult.verticesInsideCount;
    clipDiag.vertices_outside_footprint = clipResult.verticesOutsideCount;
    faceClippingDiagnostics.push(clipDiag);

    // Handle clipper degenerate output: preserve for debug but mark as failure
    if (clipResult.method === 'clipper_degenerate_output') {
      facesRejected++;
      rejectionReasons.push('polygon_clipper_failure');
      warnings.push(`face_${faceId}_clipper_degenerate: area_before=${faceAreaBeforeClipPx.toFixed(0)} area_after=${faceAreaAfterClipPx.toFixed(0)}`);
      faceRejectionTable.push({ face_id: faceId, area_sqft: 0, plane_rms: null, inside_footprint: true, mask_overlap: null, rejection_reason: 'polygon_clipper_failure' });
      enrichedFaceRejections.push({
        face_id: faceId, vertex_count: face.polygon.length, area_sqft: 0,
        bbox_geo: null, centroid_geo: null,
        inside_footprint: true, footprint_overlap_ratio: Number(bboxOverlapBeforeClip.toFixed(3)),
        mask_overlap_ratio: null, plane_rms: null, pitch_degrees: null,
        shared_edge_count: 0, boundary_edge_count: 0,
        rejection_reasons: rejectionReasons,
      });
      continue;
    }

    if (clippedPx.length < 3) {
      facesRejected++;
      rejectionReasons.push('clipped_to_nothing');

      // Fallback rule: if bbox overlap was high and face had real area, this is a clipper issue
      if (bboxOverlapBeforeClip > 0.90 && faceAreaBeforeClipPx > 100) {
        rejectionReasons.push('polygon_clipper_failure');
        warnings.push(`face_${faceId}_clipper_failure_despite_overlap: bbox_overlap=${bboxOverlapBeforeClip.toFixed(3)} area_before=${faceAreaBeforeClipPx.toFixed(0)}`);
      }

      faceRejectionTable.push({ face_id: faceId, area_sqft: 0, plane_rms: null, inside_footprint: false, mask_overlap: null, rejection_reason: rejectionReasons.join('+') });
      enrichedFaceRejections.push({
        face_id: faceId, vertex_count: face.polygon.length, area_sqft: 0,
        bbox_geo: null, centroid_geo: null,
        inside_footprint: false, footprint_overlap_ratio: Number(bboxOverlapBeforeClip.toFixed(3)),
        mask_overlap_ratio: null, plane_rms: null, pitch_degrees: null,
        shared_edge_count: 0, boundary_edge_count: 0,
        rejection_reasons: rejectionReasons,
      });
      continue;
    }

    // Convert clipped pixel polygon to geo for plane fitting, area calc, and output
    const polygonGeo: XY[] = effectiveDSM 
      ? clippedPx.map(p => pxToGeoPoint(p, effectiveDSM))
      : [];
    if (polygonGeo.length < 3) continue;

    // Plane fit & area validation (uses geo polygon for DSM sampling)
    const areaSqft = polygonAreaSqft(polygonGeo, midLat);
    const threshold = areaSqft > 200 ? 0.8 : PLANE_FIT_ERROR_THRESHOLD;
    let pitch = 0;
    let azimuth = 0;
    let planeRms: number | null = null;

    const facetCenter = polygonGeo.reduce((acc, p) => [acc[0] + p[0] / polygonGeo.length, acc[1] + p[1] / polygonGeo.length] as XY, [0, 0] as XY);

    if (effectiveDSM) {
      const planeFit = fitPlaneWithPitch(polygonGeo, effectiveDSM);
      if (planeFit) {
        planeRms = planeFit.rms;
        if (planeFit.rms > threshold) {
          facesRejected++;
          rejectionReasons.push(`plane_rms_${planeFit.rms.toFixed(3)}_gt_${threshold}`);
          faceRejectionTable.push({ face_id: faceId, area_sqft: Number(areaSqft.toFixed(2)), plane_rms: Number(planeFit.rms.toFixed(3)), inside_footprint: true, mask_overlap: null, rejection_reason: `plane_rms_${planeFit.rms.toFixed(3)}_gt_${threshold}` });
          enrichedFaceRejections.push({
            face_id: faceId, vertex_count: polygonGeo.length, area_sqft: Number(areaSqft.toFixed(2)),
            bbox_geo: getBounds(polygonGeo), centroid_geo: facetCenter,
            inside_footprint: true, footprint_overlap_ratio: Number(bboxOverlapBeforeClip.toFixed(3)),
            mask_overlap_ratio: null, plane_rms: Number(planeFit.rms.toFixed(3)), pitch_degrees: planeFit.pitchDeg,
            shared_edge_count: 0, boundary_edge_count: 0,
            rejection_reasons: rejectionReasons,
          });
          continue;
        }
        pitch = planeFit.pitchDeg;
        azimuth = planeFit.azimuthDeg;
      } else {
        const matchingSolar = findClosestSolarSegment(facetCenter, input.solarSegments);
        pitch = matchingSolar?.pitchDegrees || 0;
        azimuth = matchingSolar?.azimuthDegrees || 0;
      }
    }
    if (areaSqft < MIN_FACET_AREA_SQFT) {
      facesRejected++;
      rejectionReasons.push(`area_below_${MIN_FACET_AREA_SQFT}_sqft`);
      faceRejectionTable.push({ face_id: faceId, area_sqft: Number(areaSqft.toFixed(2)), plane_rms: planeRms !== null ? Number(planeRms.toFixed(3)) : null, inside_footprint: true, mask_overlap: null, rejection_reason: `area_below_${MIN_FACET_AREA_SQFT}_sqft` });
      enrichedFaceRejections.push({
        face_id: faceId, vertex_count: polygonGeo.length, area_sqft: Number(areaSqft.toFixed(2)),
        bbox_geo: getBounds(polygonGeo), centroid_geo: facetCenter,
        inside_footprint: true, footprint_overlap_ratio: Number(bboxOverlapBeforeClip.toFixed(3)),
        mask_overlap_ratio: null, plane_rms: planeRms !== null ? Number(planeRms.toFixed(3)) : null, pitch_degrees: pitch,
        shared_edge_count: 0, boundary_edge_count: 0,
        rejection_reasons: rejectionReasons,
      });
      continue;
    }
    const closedPolygon = vertexKey(polygonGeo[0]) === vertexKey(polygonGeo[polygonGeo.length - 1]) ? polygonGeo : [...polygonGeo, polygonGeo[0]];
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

  // ===== TOPOLOGY FIX: Overlap detection and removal =====
  let overlappingFaceCount = 0;
  if (graphFaces.length > 1) {
    const toRemove = new Set<number>();
    for (let i = 0; i < graphFaces.length; i++) {
      if (toRemove.has(i)) continue;
      for (let j = i + 1; j < graphFaces.length; j++) {
        if (toRemove.has(j)) continue;
        const polyI = graphFaces[i].polygon.slice(0, -1);
        const polyJ = graphFaces[j].polygon.slice(0, -1);
        const centroidJ: XY = polyJ.reduce((acc, p) => [acc[0] + p[0] / polyJ.length, acc[1] + p[1] / polyJ.length] as XY, [0, 0] as XY);
        const centroidI: XY = polyI.reduce((acc, p) => [acc[0] + p[0] / polyI.length, acc[1] + p[1] / polyI.length] as XY, [0, 0] as XY);
        const jInsideI = pointInPolygon(centroidJ, polyI);
        const iInsideJ = pointInPolygon(centroidI, polyJ);
        if (jInsideI && iInsideJ) {
          overlappingFaceCount++;
          if (graphFaces[i].plan_area_sqft >= graphFaces[j].plan_area_sqft) {
            toRemove.add(j);
          } else {
            toRemove.add(i);
            break;
          }
        } else if (jInsideI || iInsideJ) {
          const smallerArea = Math.min(graphFaces[i].plan_area_sqft, graphFaces[j].plan_area_sqft);
          const largerArea = Math.max(graphFaces[i].plan_area_sqft, graphFaces[j].plan_area_sqft);
          if (smallerArea / largerArea > 0.8) {
            overlappingFaceCount++;
            toRemove.add(graphFaces[i].plan_area_sqft <= graphFaces[j].plan_area_sqft ? i : j);
          }
        }
      }
    }
    if (toRemove.size > 0) {
      const indices = [...toRemove].sort((a, b) => b - a);
      for (const idx of indices) graphFaces.splice(idx, 1);
      for (let i = 0; i < graphFaces.length; i++) {
        graphFaces[i].id = `SF-${String.fromCharCode(65 + i)}`;
        graphFaces[i].label = String.fromCharCode(65 + i);
      }
      console.log(`  Overlap removal: removed ${toRemove.size} overlapping faces, ${graphFaces.length} remain`);
    }
  }

  // ===== Area conservation check =====
  const totalFacePlanArea = graphFaces.reduce((s, f) => s + f.plan_area_sqft, 0);
  const areaConservationRatio = footprintAreaSqft > 0 ? totalFacePlanArea / footprintAreaSqft : 0;
  if (areaConservationRatio > 1.15) {
    const scaleFactor = footprintAreaSqft / totalFacePlanArea;
    warnings.push(`area_inflation_${areaConservationRatio.toFixed(2)}_corrected_by_scale_${scaleFactor.toFixed(3)}`);
    console.log(`  AREA CONSERVATION: ratio=${areaConservationRatio.toFixed(2)}, scaling faces by ${scaleFactor.toFixed(3)}`);
    for (const face of graphFaces) {
      face.plan_area_sqft *= scaleFactor;
      face.roof_area_sqft *= scaleFactor;
    }
  } else if (areaConservationRatio > 0 && areaConservationRatio < 0.5) {
    warnings.push(`low_coverage_${areaConservationRatio.toFixed(2)}_faces_cover_lt_50pct`);
  }
  console.log(`  Area conservation: ratio=${areaConservationRatio.toFixed(3)} (faces=${totalFacePlanArea.toFixed(0)} vs footprint=${footprintAreaSqft.toFixed(0)})`);

  faceCountAfterMerge = graphFaces.length;

  let edgeId = 0;
  const outputEdges: GraphEdge[] = [];
  const outputVerticesByKey = new Map<string, XY>();
  const addVertex = (p: XY) => outputVerticesByKey.set(vertexKey(p), p);

  // ===== CANONICAL SHARED EDGE SYSTEM =====
  const GEO_SNAP_DIGITS = 7;
  function geoVertexKey(p: XY): string {
    return `${p[0].toFixed(GEO_SNAP_DIGITS)},${p[1].toFixed(GEO_SNAP_DIGITS)}`;
  }
  function geoEdgeKey(a: XY, b: XY): string {
    const ka = geoVertexKey(a), kb = geoVertexKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  }

  const canonicalEdgeMap = new Map<string, { faceIndices: number[]; start: XY; end: XY }>();
  let sharedEdgeCount = 0;
  let duplicateEdgeCount = 0;

  for (let fi = 0; fi < graphFaces.length; fi++) {
    const poly = graphFaces[fi].polygon;
    for (let pi = 0; pi < poly.length - 1; pi++) {
      const a = poly[pi], b = poly[pi + 1];
      const key = geoEdgeKey(a, b);
      const existing = canonicalEdgeMap.get(key);
      if (existing) {
        if (!existing.faceIndices.includes(fi)) {
          existing.faceIndices.push(fi);
          sharedEdgeCount++;
        } else {
          duplicateEdgeCount++;
        }
      } else {
        canonicalEdgeMap.set(key, { faceIndices: [fi], start: a, end: b });
      }
    }
  }
  console.log(`  Canonical edges: ${canonicalEdgeMap.size} unique, ${sharedEdgeCount} shared between faces, ${duplicateEdgeCount} duplicates removed`);

  // ===== EMIT EDGES FROM CANONICAL MAP =====
  let skippedNoFace = 0;
  
  const segKeyFromPts = (a: { x: number; y: number }, b: { x: number; y: number }): string => {
    const ka = `${Math.round(a.x)}:${Math.round(a.y)}`;
    const kb = `${Math.round(b.x)}:${Math.round(b.y)}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };

  const segFaceMap = new Map<string, number[]>();
  for (let fi = 0; fi < planar.faces.length; fi++) {
    const poly = planar.faces[fi].polygon;
    for (let pi = 0; pi < poly.length; pi++) {
      const a = poly[pi];
      const b = poly[(pi + 1) % poly.length];
      const key = segKeyFromPts(a, b);
      const arr = segFaceMap.get(key) || [];
      arr.push(fi);
      segFaceMap.set(key, arr);
    }
  }

  for (const [_key, canonical] of canonicalEdgeMap) {
    const { start, end, faceIndices } = canonical;
    const lengthFt = distanceFt(start, end, midLat);
    if (lengthFt < 1) continue;

    let edgeType: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'unclassified';
    let edgeSource: 'dsm' | 'perimeter' = 'dsm';
    let edgeScore = 0.8;

    const edgeMid: XY = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    let onFootprintBoundary = false;
    for (let i = 0; i < input.footprintCoords.length; i++) {
      const fpa = input.footprintCoords[i];
      const fpb = input.footprintCoords[(i + 1) % input.footprintCoords.length];
      const dx = fpb[0] - fpa[0], dy = fpb[1] - fpa[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-16) continue;
      const t = Math.max(0, Math.min(1, ((edgeMid[0] - fpa[0]) * dx + (edgeMid[1] - fpa[1]) * dy) / len2));
      const proj: XY = [fpa[0] + t * dx, fpa[1] + t * dy];
      const distToFootprint = Math.hypot(edgeMid[0] - proj[0], edgeMid[1] - proj[1]);
      if (distToFootprint < 2e-6) {
        onFootprintBoundary = true;
        break;
      }
    }

    if (faceIndices.length >= 2 && !onFootprintBoundary) {
      edgeType = 'unclassified';
      edgeSource = 'dsm';
      edgeScore = 0.85;
    } else if (onFootprintBoundary) {
      edgeType = 'eave';
      edgeSource = 'perimeter';
      edgeScore = 0.85;
    } else {
      if (effectiveDSM) {
        const pxA = geoToPxPoint(start, effectiveDSM);
        const pxB = geoToPxPoint(end, effectiveDSM);
        const classified = classifyPlanarSegment({ a: pxA, b: pxB }, footprintPxCCW, dsmInteriorEdgesPx);
        edgeType = classified.type;
        edgeSource = classified.source;
        edgeScore = classified.score;
      } else {
        edgeType = 'unclassified';
      }
    }

    addVertex(start);
    addVertex(end);
    const eid = `GE-${edgeId++}`;
    const facetIds = faceIndices.map(fi => graphFaces[fi]?.id).filter(Boolean);
    for (const fi of faceIndices) {
      if (graphFaces[fi]) {
        graphFaces[fi].edge_ids.push(eid);
      }
    }

    outputEdges.push({
      id: eid,
      type: edgeType,
      start,
      end,
      length_ft: lengthFt,
      confidence: {
        dsm_score: edgeSource === 'dsm' ? 0.85 : 0.8,
        rgb_score: 0,
        solar_azimuth_score: 0.5,
        topology_score: faceIndices.length >= 2 ? 0.95 : (faceIndices.length === 1 ? 0.7 : 0.2),
        length_score: lengthFt > 10 ? 0.8 : 0.5,
        final_confidence: edgeScore,
      },
      facet_ids: facetIds,
      source: edgeSource,
    });
  }
  console.log(`  Edge output: ${outputEdges.length} emitted from canonical map`);
  console.log(`  Faces: ${graphFaces.length} valid, ${facesRejected} rejected by plane fit/area`);

  // ===== FACE-ADJACENCY EDGE RECLASSIFICATION =====
  if (graphFaces.length >= 2 && effectiveDSM) {
    const facePlanes: Array<{ slopeX: number; slopeY: number; centroid: XY } | null> = graphFaces.map(face => {
      const poly = face.polygon;
      if (poly.length < 3) return null;
      const { bounds, width, height, data, noDataValue } = effectiveDSM;
      const midLatLocal = (bounds.minLat + bounds.maxLat) / 2;
      const metersPerPixelX = (bounds.maxLng - bounds.minLng) / width * 111320 * Math.cos(midLatLocal * Math.PI / 180);
      const metersPerPixelY = (bounds.maxLat - bounds.minLat) / height * 111320;
      
      const minPxX = Math.max(0, Math.floor((Math.min(...poly.map(p => p[0])) - bounds.minLng) / (bounds.maxLng - bounds.minLng) * width));
      const maxPxX = Math.min(width - 1, Math.ceil((Math.max(...poly.map(p => p[0])) - bounds.minLng) / (bounds.maxLng - bounds.minLng) * width));
      const minPxY = Math.max(0, Math.floor((bounds.maxLat - Math.max(...poly.map(p => p[1]))) / (bounds.maxLat - bounds.minLat) * height));
      const maxPxY = Math.min(height - 1, Math.ceil((bounds.maxLat - Math.min(...poly.map(p => p[1]))) / (bounds.maxLat - bounds.minLat) * height));
      
      const points: Array<{ x: number; y: number; z: number }> = [];
      for (let py = minPxY; py <= maxPxY; py++) {
        for (let px = minPxX; px <= maxPxX; px++) {
          const lng = bounds.minLng + ((px + 0.5) / width) * (bounds.maxLng - bounds.minLng);
          const lat = bounds.maxLat - ((py + 0.5) / height) * (bounds.maxLat - bounds.minLat);
          if (!pointInPolygon([lng, lat], poly)) continue;
          const z = data[py * width + px];
          if (z === noDataValue || isNaN(z)) continue;
          points.push({ x: px, y: py, z });
        }
      }
      if (points.length < 6) return null;
      
      const N = points.length;
      let Sx = 0, Sy = 0, Sz = 0, Sxx = 0, Sxy = 0, Syy = 0, Sxz = 0, Syz = 0;
      for (const p of points) {
        Sx += p.x; Sy += p.y; Sz += p.z;
        Sxx += p.x * p.x; Sxy += p.x * p.y; Syy += p.y * p.y;
        Sxz += p.x * p.z; Syz += p.y * p.z;
      }
      const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, N]];
      const B = [Sxz, Syz, Sz];
      const detVal = det3(A);
      if (Math.abs(detVal) < 1e-10) return null;
      const a = det3(replCol(A, B, 0)) / detVal;
      const b = det3(replCol(A, B, 1)) / detVal;
      
      const centroid: XY = [
        poly.reduce((s, p) => s + p[0], 0) / poly.length,
        poly.reduce((s, p) => s + p[1], 0) / poly.length,
      ];
      return { slopeX: a / metersPerPixelX, slopeY: b / metersPerPixelY, centroid };
    });

    let reclassified = 0;
    for (const edge of outputEdges) {
      if (edge.type === 'eave' || edge.type === 'rake') continue;
      
      const eKey = geoEdgeKey(edge.start, edge.end);
      const canonical = canonicalEdgeMap.get(eKey);
      const adjacentFaceIndices = canonical?.faceIndices || [];

      if (adjacentFaceIndices.length < 2) continue;

      const planeA = facePlanes[adjacentFaceIndices[0]];
      const planeB = facePlanes[adjacentFaceIndices[1]];
      if (!planeA || !planeB) continue;

      const edgeMidLocal: XY = [(edge.start[0] + edge.end[0]) / 2, (edge.start[1] + edge.end[1]) / 2];
      const edgeDx = edge.end[0] - edge.start[0];
      const edgeDy = edge.end[1] - edge.start[1];
      const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
      if (edgeLen < 1e-12) continue;
      const perpX = -edgeDy / edgeLen;
      const perpY = edgeDx / edgeLen;

      const dotA = (planeA.centroid[0] - edgeMidLocal[0]) * perpX + (planeA.centroid[1] - edgeMidLocal[1]) * perpY;
      const dotB = (planeB.centroid[0] - edgeMidLocal[0]) * perpX + (planeB.centroid[1] - edgeMidLocal[1]) * perpY;

      const downslopeA_perp = -(planeA.slopeX * perpX + planeA.slopeY * perpY);
      const downslopeB_perp = -(planeB.slopeX * perpX + planeB.slopeY * perpY);

      const slopeAwayA = dotA > 0 ? downslopeA_perp : -downslopeA_perp;
      const slopeAwayB = dotB > 0 ? -downslopeB_perp : downslopeB_perp;

      const slopeThreshold = 0.02;
      const aDescends = slopeAwayA > slopeThreshold;
      const bDescends = slopeAwayB > slopeThreshold;
      const aAscends = slopeAwayA < -slopeThreshold;
      const bAscends = slopeAwayB < -slopeThreshold;

      let newType: 'ridge' | 'valley' | 'hip' | null = null;
      if (aDescends && bDescends) {
        newType = 'ridge';
      } else if (aAscends && bAscends) {
        newType = 'valley';
      } else if ((aDescends && bAscends) || (aAscends && bDescends)) {
        newType = 'hip';
      }

      if (newType) {
        if (newType !== edge.type) reclassified++;
        edge.type = newType;
      }
    }
    if (reclassified > 0) {
      console.log(`  Face-adjacency reclassification: ${reclassified} edges reclassified`);
    }
  }

  // Totals
  const outRidges = outputEdges.filter(e => e.type === 'ridge');
  const outHips = outputEdges.filter(e => e.type === 'hip');
  const outValleys = outputEdges.filter(e => e.type === 'valley');
  const outEaves = outputEdges.filter(e => e.type === 'eave');
  const outRakes = outputEdges.filter(e => e.type === 'rake');
  const outUnclassified = outputEdges.filter(e => e.type === 'unclassified');
  const structuralEdgeCount = outRidges.length + outHips.length + outValleys.length;

  // ===== FOOTPRINT BOUNDARY CHECK =====
  let edgesOutsideFootprintCount = 0;
  let maxEndpointDistanceOutsideFootprintPx = 0;
  const footprintGeo = input.footprintCoords;
  for (const edge of outputEdges) {
    const startInside = pointInPolygon(edge.start, footprintGeo);
    const endInside = pointInPolygon(edge.end, footprintGeo);
    if (!startInside || !endInside) {
      edgesOutsideFootprintCount++;
      if (effectiveDSM) {
        for (const pt of [edge.start, edge.end]) {
          if (!pointInPolygon(pt, footprintGeo)) {
            let minDist = Infinity;
            for (let i = 0; i < footprintGeo.length; i++) {
              const a = footprintGeo[i];
              const b = footprintGeo[(i + 1) % footprintGeo.length];
              const dx = b[0] - a[0], dy = b[1] - a[1];
              const len2 = dx * dx + dy * dy;
              let t = len2 > 0 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2 : 0;
              t = Math.max(0, Math.min(1, t));
              const px = a[0] + t * dx, py = a[1] + t * dy;
              const dist = Math.hypot(pt[0] - px, pt[1] - py);
              if (dist < minDist) minDist = dist;
            }
            const pxDist = minDist * effectiveDSM.width / (effectiveDSM.bounds.maxLng - effectiveDSM.bounds.minLng);
            if (pxDist > maxEndpointDistanceOutsideFootprintPx) {
              maxEndpointDistanceOutsideFootprintPx = pxDist;
            }
          }
        }
      }
    }
  }
  maxEndpointDistanceOutsideFootprintPx = Math.round(maxEndpointDistanceOutsideFootprintPx * 100) / 100;

  const totalRoofArea = graphFaces.reduce((s, f) => s + f.roof_area_sqft, 0);
  const totalPlanArea = graphFaces.reduce((s, f) => s + f.plan_area_sqft, 0);
  const attemptedAreaTotal = planar.faces.reduce((s: number, face: unknown) => {
    const f = face as { polygon: Array<{ x: number; y: number }> };
    const polygon = effectiveDSM ? f.polygon.map((p) => pxToGeoPoint(p, effectiveDSM)) : [];
    return polygon.length >= 3 ? s + polygonAreaSqft(polygon, midLat) : s;
  }, 0);

  // ===== COVERAGE: use sqft ratio as canonical, detect px/sqft mismatch =====
  const sqftAreaRatio = footprintAreaSqft > 0 ? totalPlanArea / footprintAreaSqft : 0;
  const totalFaceAreaPx = graphFaces.reduce((s, f) => {
    // Re-compute face area in DSM px from the clipped px polygons we already have
    // We stored face polygons in geo; convert back for diagnostic
    if (!effectiveDSM) return s;
    const pxPoly = f.polygon.slice(0, -1).map(p => geoToPxPoint(p, effectiveDSM));
    return s + polygonAreaPx(pxPoly);
  }, 0);
  const pxAreaRatio = footprintAreaPxVal > 0 ? totalFaceAreaPx / footprintAreaPxVal : 0;
  const coverageAreaSpaceMismatch = sqftAreaRatio > 0.85 && pxAreaRatio < 0.50;
  
  // CANONICAL: coverage uses sqft ratio. Never mix pixel-space planar ratio.
  const coverageRatio = sqftAreaRatio;
  
  if (coverageAreaSpaceMismatch) {
    warnings.push(`coverage_area_space_mismatch: sqft_ratio=${sqftAreaRatio.toFixed(3)} but px_ratio=${pxAreaRatio.toFixed(3)} — footprint_px and face_px may be in different scales`);
    console.log(`  [COVERAGE_MISMATCH] sqft_ratio=${sqftAreaRatio.toFixed(3)} px_ratio=${pxAreaRatio.toFixed(3)} footprint_area_px=${footprintAreaPxVal.toFixed(0)} face_area_px=${totalFaceAreaPx.toFixed(0)}`);
  }
  console.log(`  Coverage: sqft_ratio=${sqftAreaRatio.toFixed(3)} px_ratio=${pxAreaRatio.toFixed(3)} footprint_sqft=${footprintAreaSqft.toFixed(0)} face_sqft=${totalPlanArea.toFixed(0)} footprint_px=${footprintAreaPxVal.toFixed(0)} face_px=${totalFaceAreaPx.toFixed(0)}`);

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
      hipFt: outHips.reduce((s, e) => s + e.length_ft, 0),
      graphConnected: graphFaces.length >= 2 && coverageRatio >= 0.85,
      coverageRatio,
      structuralEdgeCount,
      dsmEdgesAccepted: classifiedEdges.filter(e => e.source === 'dsm').length,
    },
    complexity
  );
  if (!validation.valid && planar.faces.length > 0 && graphFaces.length === 0) {
    validation.status = 'faces_extracted_but_rejected';
    validation.reason = `Planar graph extracted ${planar.faces.length} attempted faces, but 0 passed validation`;
  }
  const invalidEdgeClassification = complexity.isComplex && outRidges.length === 0 && outValleys.length === 0 && outHips.reduce((s, e) => s + e.length_ft, 0) > 50;
  if (!validation.valid && invalidEdgeClassification) {
    validation.status = 'invalid_edge_classification';
    validation.reason = 'Complex roof has 0 ridges, 0 valleys, and >50 LF of hips after face-adjacency reclassification';
  }

  // ===== HARD BLOCK: edges outside footprint =====
  let customerBlockReason = validation.valid ? (planar.debug.customer_block_reason || null) : validation.status;
  if (edgesOutsideFootprintCount > 0) {
    customerBlockReason = customerBlockReason || 'edges_outside_footprint';
    warnings.push(`${edgesOutsideFootprintCount} edges have endpoints outside footprint (max dist ${maxEndpointDistanceOutsideFootprintPx}px)`);
  }

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

  const edgeClassCountsPre = (edgeClassificationDebug as any)?.counts ?? {};
  const edgeClassCountsPost = {
    ridge: outRidges.length,
    hip: outHips.length,
    valley: outValleys.length,
    eave: outEaves.length,
    rake: outRakes.length,
    unclassified: outUnclassified.length,
  };

  let nullEndpointCount = 0;
  for (const e of outputEdges) {
    if (!e.start || !e.end || !Number.isFinite(e.start[0]) || !Number.isFinite(e.start[1]) || !Number.isFinite(e.end[0]) || !Number.isFinite(e.end[1])) {
      nullEndpointCount++;
    }
  }

  const edgeEmitDiagnostics = {
    edge_emit_policy: 'canonical_shared_edge_map',
    canonical_edges_total: canonicalEdgeMap.size,
    shared_edge_count: sharedEdgeCount,
    duplicate_edge_count: duplicateEdgeCount,
    overlapping_face_count: overlappingFaceCount,
    area_conservation_ratio: Number(areaConservationRatio.toFixed(3)),
    footprint_area_sqft: Number(footprintAreaSqft.toFixed(0)),
    total_face_plan_area_sqft: Number(totalPlanArea.toFixed(0)),
    segments_input_total: planar.edges.length,
    segments_skipped_no_faces: skippedNoFace,
    segments_emitted_structural_2_faces: outputEdges.filter(e => e.facet_ids.length >= 2).length,
    segments_emitted_boundary_1_face: outputEdges.filter(e => e.type === 'eave' || e.type === 'rake').length,
    emitted_edges_total: outputEdges.length,
    ridge_edges_total: outRidges.length,
    hip_edges_total: outHips.length,
    valley_edges_total: outValleys.length,
    eave_edges_total: outEaves.length,
    rake_edges_total: outRakes.length,
    unclassified_edges_total: outUnclassified.length,
    edges_outside_footprint_count: edgesOutsideFootprintCount,
    max_endpoint_distance_outside_footprint_px: maxEndpointDistanceOutsideFootprintPx,
    edge_class_counts_pre: edgeClassCountsPre,
    edge_class_counts_post: edgeClassCountsPost,
    null_endpoint_count: nullEndpointCount,
    footprint_winding: footprintWinding,
    footprint_self_intersects: footprintSelfIntersects,
    footprint_area_px: Number(footprintAreaPxVal.toFixed(0)),
    // v7: explicit area-space diagnostics
    sqft_area_ratio: Number(sqftAreaRatio.toFixed(3)),
    px_area_ratio: Number(pxAreaRatio.toFixed(3)),
    coverage_area_space_mismatch: coverageAreaSpaceMismatch,
    footprint_dsm_px_area: Number(footprintAreaPxVal.toFixed(0)),
    faces_dsm_px_area: Number(totalFaceAreaPx.toFixed(0)),
    footprint_area_sqft_diag: Number(footprintAreaSqft.toFixed(0)),
    faces_area_sqft_diag: Number(totalPlanArea.toFixed(0)),
  };

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
    faces_rejected_by_area: planar.debug.faces_rejected_by_area || 0,
    coverage_ratio: coverageRatio,
    confidence: avgConfidence,
    graph_valid: graphFaces.length >= 2 && coverageRatio >= 0.85,
    warnings,
    timing_ms: timingMs,
    dsm_edges_detected: dsmRidges.length + dsmValleys.length,
    dsm_edges_accepted: classifiedEdges.filter(e => e.source === 'dsm').length,
    edge_count_after_cluster: edgeCountAfterCluster,
    interior_lines_used: dsmInteriorEdgesPx.length,
    graph_nodes: planar.debug.total_graph_nodes,
    graph_segments: planar.debug.total_graph_segments,
    intersections_split: planar.debug.intersections_split,
    intersection_filter_skipped: planar.debug.intersection_filter_skipped || 0,
    cluster_merges: 0,
    collinear_merges: planar.debug.collinear_merges || 0,
    fragment_merges: planar.debug.fragment_merges || 0,
    dangling_edges_removed: planar.debug.dangling_edges_removed,
    faces_extracted: planar.debug.faces_extracted,
    face_count_before_merge: faceCountBeforeMerge,
    face_count_after_merge: faceCountAfterMerge,
    valid_faces: graphFaces.length,
    attempted_area_total: attemptedAreaTotal,
    attempted_face_count: planar.faces.length,
    attempted_edge_count: outputEdges.length,
    face_rejection_table: faceRejectionTable,
    edge_classification_debug: { ...edgeClassificationDebug, ...edgeEmitDiagnostics },
    pitch_source: 'dsm_plane_fit',
    dsm_mask_valid: dsmMaskValid,
    topology_source: 'autonomous_dsm_graph_solver',
    facet_source: 'dsm_planar_graph_faces',
    hard_fail_reason: validation.valid ? null : validation.status,
    customer_block_reason: customerBlockReason,
  };

  console.log(`[EDGE_EMIT_DIAGNOSTICS] ${JSON.stringify(edgeEmitDiagnostics)}`);
  console.log(`[TOPOLOGY_METRICS] shared_edges=${sharedEdgeCount} duplicates=${duplicateEdgeCount} overlaps=${overlappingFaceCount} area_conservation=${areaConservationRatio.toFixed(3)}`);
  console.log(`[AUTONOMOUS_GRAPH_SOLVER] Validation: ${validation.status}${validation.reason ? ` — ${validation.reason}` : ''}`);

  // Build edge rejection summary
  const edgeRejectionSummary: EdgeRejectionSummary = {
    total_raw: totalRaw,
    rejected_by_length: rejectedByLength,
    rejected_by_footprint: rejectedByFootprint,
    rejected_by_score: prunedByScore,
    rejected_by_intersection: prunedByIntersection,
    rejected_by_duplicate: duplicateEdgeCount,
    rejected_by_connectivity: planar.debug.dangling_edges_removed || 0,
    accepted_final: outputEdges.length,
    acceptance_ratio: Number(edgeAcceptanceRatio.toFixed(3)),
    edge_filter_over_aggressive: edgeFilterOverAggressive,
  };

  // ===== FAILURE CATEGORY CLASSIFICATION =====
  const hasClipperFailures = enrichedFaceRejections.some(fr => fr.rejection_reasons.includes('polygon_clipper_failure'));
  const failureCategory: FailureCategory = (() => {
    if (validation.valid) return 'validated';
    // Clipper failure: faces existed but clipping destroyed them
    if (hasClipperFailures && planar.faces.length > 0 && graphFaces.length === 0) return 'polygon_clipper_failure';
    if (edgeAcceptanceRatio < 0.15 && graphFaces.length < 2) return 'edge_filter_failure';
    if (scoredEdges.length < 3) return 'structural_signal_failure';
    if (planar.faces.length > 0 && graphFaces.length === 0) return 'face_validation_failure';
    if (graphFaces.length >= 2 && coverageRatio > 0 && coverageRatio < 0.85) return 'partial_topology_success';
    if (complexity.isComplex && graphFaces.length <= 4) return 'topology_collapse';
    if (graphFaces.length < 2) return 'edge_filter_failure';
    return 'partial_topology_success';
  })();

  // ===== DOMINANT REJECTION ANALYSIS =====
  const edgeRejectionHistogram: Record<string, number> = {
    rejected_by_length: rejectedByLength,
    rejected_by_footprint: rejectedByFootprint,
    rejected_by_score: prunedByScore,
    rejected_by_intersection: prunedByIntersection,
    rejected_by_duplicate: duplicateEdgeCount,
    rejected_by_connectivity: planar.debug.dangling_edges_removed || 0,
  };
  const totalEdgeRejections = Object.values(edgeRejectionHistogram).reduce((s, v) => s + v, 0);
  const dominantEdge = Object.entries(edgeRejectionHistogram).sort((a, b) => b[1] - a[1])[0];

  const faceRejectionHistogram: Record<string, number> = {};
  for (const fr of enrichedFaceRejections) {
    for (const reason of fr.rejection_reasons) {
      const key = reason.replace(/[0-9.]+/g, 'N');
      faceRejectionHistogram[key] = (faceRejectionHistogram[key] || 0) + 1;
    }
  }
  const totalFaceRejections = enrichedFaceRejections.length;
  const dominantFace = Object.entries(faceRejectionHistogram).sort((a, b) => b[1] - a[1])[0];

  const dominantRejection: DominantRejectionAnalysis = {
    dominant_edge_rejection_reason: dominantEdge?.[0] || null,
    dominant_edge_rejection_count: dominantEdge?.[1] || 0,
    dominant_edge_rejection_pct: totalEdgeRejections > 0 ? Number(((dominantEdge?.[1] || 0) / totalEdgeRejections * 100).toFixed(1)) : 0,
    dominant_face_rejection_reason: dominantFace?.[0] || null,
    dominant_face_rejection_count: dominantFace?.[1] || 0,
    dominant_face_rejection_pct: totalFaceRejections > 0 ? Number(((dominantFace?.[1] || 0) / totalFaceRejections * 100).toFixed(1)) : 0,
    edge_rejection_histogram: edgeRejectionHistogram,
    face_rejection_histogram: faceRejectionHistogram,
  };

  console.log(`[FAILURE_CATEGORY] ${failureCategory}`);
  console.log(`[DOMINANT_REJECTION] edge: ${dominantRejection.dominant_edge_rejection_reason} (${dominantRejection.dominant_edge_rejection_pct}%), face: ${dominantRejection.dominant_face_rejection_reason} (${dominantRejection.dominant_face_rejection_pct}%)`);

  return {
    success: validation.valid,
    graph_connected: graphFaces.length >= 2 && coverageRatio >= 0.85,
    face_coverage_ratio: coverageRatio,
    validation_status: validation.status,
    failure_reason: validation.reason,
    failure_category: failureCategory,
    dominant_rejection: dominantRejection,
    vertices: outputVertices,
    edges: outputEdges,
    faces: graphFaces,
    rejected_edges: rejectedEdgesDebug,
    face_rejection_table: faceRejectionTable,
    enriched_face_rejections: enrichedFaceRejections,
    edge_rejection_summary: edgeRejectionSummary,
    face_clipping_diagnostics: faceClippingDiagnostics,
    bbox_rescue_used_for_display_only: false,
    bbox_rescue_used_in_validation: false,
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
    coordinate_space_solver: 'dsm_px' as const,
    coordinate_space_export: 'geo' as const,
    coordinate_space_footprint: 'dsm_px' as const,
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

function getBoundsPx(pts: PxPt[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...pts.map(p => p.x)),
    maxX: Math.max(...pts.map(p => p.x)),
    minY: Math.min(...pts.map(p => p.y)),
    maxY: Math.max(...pts.map(p => p.y)),
  };
}
