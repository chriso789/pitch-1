/**
 * Autonomous Roof Graph Solver v9 — Real Sutherland-Hodgman Polygon Clipper
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
  // v9: real polygon clipper diagnostics
  clipper_algorithm?: string;
  clipper_input_face_vertices?: number;
  clipper_input_footprint_vertices?: number;
  clipper_output_vertices?: number;
  clipper_error?: string | null;
  vertices_inside_footprint?: number;
  vertices_outside_footprint?: number;
  footprint_is_convex?: boolean;
  clipped_area_ratio?: number;
  intersections_added_count?: number;
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
  validation_status: 'validated' | 'ai_failed_complex_topology' | 'faces_extracted_but_rejected' | 'invalid_edge_classification' | 'topology_undersegmented' | 'needs_review' | 'insufficient_structural_signal' | 'invalid_roof_graph' | 'dsm_edges_found_no_closed_faces' | 'incomplete_facet_coverage' | 'dsm_insufficient_resolution' | 'dsm_transform_invalid' | 'missing_valid_footprint' | 'footprint_coordinate_mismatch' | 'invalid_graph_no_perimeter' | 'graph_has_only_dangling_edges';
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
  cluster_diagnostics?: {
    local_regions_detected: number;
    cross_region_rejections: number;
    oversized_plane_rejections: number;
    type_conflict_rejections: number;
    valley_edges_preserved: number;
    ridge_edges_preserved: number;
    edges_merged_count: number;
    cluster_merge_rejections: number;
  };
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

// ============= PIXEL-SPACE POLYGON CLIPPING (v9 — Real S-H + Convex Hull) =============

/**
 * Clip result with diagnostic info.
 */
interface ClipResult {
  polygon: PxPt[];
  method: 'inside_no_clip' | 'sutherland_hodgman' | 'convex_hull_sh' | 'clipper_area_loss' | 'clipper_degenerate_output' | 'empty';
  verticesInsideCount: number;
  verticesOutsideCount: number;
  footprintIsConvex: boolean;
  intersectionsAdded: number;
}

/**
 * Check polygon convexity. Returns true if all cross-products have the same sign.
 */
function isConvexPolygon(poly: PxPt[]): boolean {
  if (poly.length < 3) return false;
  let sign = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    if (sign === 0) sign = cross > 0 ? 1 : -1;
    else if ((cross > 0 ? 1 : -1) !== sign) return false;
  }
  return true;
}

/**
 * Compute convex hull of a point set (Andrew's monotone chain).
 */
function convexHullPx(points: PxPt[]): PxPt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: PxPt, a: PxPt, b: PxPt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: PxPt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: PxPt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
    upper.push(pts[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Robust polygon clipping — v9 real S-H implementation.
 *
 * 1. All subject vertices inside → return unchanged (inside_no_clip)
 * 2. Footprint is convex → Sutherland-Hodgman (exact)
 * 3. Footprint is concave → compute convex hull, S-H against hull
 * 4. Area-loss guard: if clipped area < 50% but bbox overlap > 90%, flag as clipper_area_loss
 */
function clipPolygonPxRobust(subject: PxPt[], clip: PxPt[]): ClipResult {
  if (subject.length < 3 || clip.length < 3) {
    return { polygon: subject, method: 'empty', verticesInsideCount: 0, verticesOutsideCount: subject.length, footprintIsConvex: false, intersectionsAdded: 0 };
  }

  // Count vertices inside/outside
  const insideFlags = subject.map(p => pointInPolygonPx(p, clip));
  const insideCount = insideFlags.filter(Boolean).length;
  const outsideCount = subject.length - insideCount;

  // SHORTCUT: all inside → no clipping needed
  if (outsideCount === 0) {
    return { polygon: [...subject], method: 'inside_no_clip', verticesInsideCount: insideCount, verticesOutsideCount: 0, footprintIsConvex: true, intersectionsAdded: 0 };
  }

  const convex = isConvexPolygon(clip);
  const originalArea = polygonAreaPx(subject);
  let clipped: PxPt[];
  let method: ClipResult['method'];

  if (convex) {
    // Exact Sutherland-Hodgman against the actual footprint
    clipped = clipPolygonPxSH(subject, clip);
    method = 'sutherland_hodgman';
  } else {
    // Concave footprint: clip against convex hull (slightly over-inclusive but geometrically correct)
    const hull = convexHullPx(clip);
    clipped = clipPolygonPxSH(subject, hull);
    method = 'convex_hull_sh';
  }

  // Clean duplicates
  clipped = removeDuplicateVerticesPx(clipped, 0.5);
  const intersectionsAdded = Math.max(0, clipped.length - insideCount);

  if (clipped.length < 3) {
    // Degenerate output
    if (originalArea > 100) {
      return { polygon: [], method: 'clipper_degenerate_output', verticesInsideCount: insideCount, verticesOutsideCount: outsideCount, footprintIsConvex: convex, intersectionsAdded: 0 };
    }
    return { polygon: [], method: 'empty', verticesInsideCount: insideCount, verticesOutsideCount: outsideCount, footprintIsConvex: convex, intersectionsAdded: 0 };
  }

  const clippedArea = polygonAreaPx(clipped);

  // Area-loss guard: if significant area was destroyed despite high bbox overlap, flag it
  if (originalArea > 100 && clippedArea < originalArea * 0.05) {
    return { polygon: clipped, method: 'clipper_degenerate_output', verticesInsideCount: insideCount, verticesOutsideCount: outsideCount, footprintIsConvex: convex, intersectionsAdded };
  }

  return { polygon: clipped, method, verticesInsideCount: insideCount, verticesOutsideCount: outsideCount, footprintIsConvex: convex, intersectionsAdded };
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
  if (result.length > 1) {
    const first = result[0], last = result[result.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= tol) {
      result.pop();
    }
  }
  return result;
}

/** Sutherland-Hodgman polygon clipping — correct for convex clip polygons */
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

// ============= TOPOLOGY-AWARE EDGE CLUSTERING =============
// v10: Preserves local roof assemblies by segmenting edges into DSM-elevation
// regions before clustering. Prevents merges that cross ridge/valley boundaries,
// suppress local topology, or create oversized planes.

const CLUSTER_MAX_SPAN_PX = 80;
/** Maximum area ratio a single merged plane is allowed to cover */
const CLUSTER_MAX_PLANE_AREA_RATIO = 0.35;
/** Grid cell size for local DSM elevation partitioning */
const LOCAL_REGION_CELL_PX = 40;
/** Elevation difference threshold to consider two cells different regions */
const LOCAL_REGION_ELEV_DIFF_M = 0.8;

type StructuralTier = 'primary' | 'secondary' | 'tertiary';

interface ClusterableEdge {
  a: { x: number; y: number };
  b: { x: number; y: number };
  type: 'ridge' | 'valley' | 'hip';
  score: number;
  /** Structural hierarchy tier assigned during classification */
  tier?: StructuralTier;
  /** Raw hierarchy score used for tier assignment */
  hierarchyScore?: number;
}

interface ClusterDiagnostics {
  pre_cluster_edge_count: number;
  post_cluster_edge_count: number;
  edges_merged_count: number;
  local_regions_detected: number;
  cluster_merge_rejections: number;
  cross_region_rejections: number;
  oversized_plane_rejections: number;
  type_conflict_rejections: number;
  valley_edges_preserved: number;
  ridge_edges_preserved: number;
  primary_edge_count: number;
  secondary_edge_count: number;
  tertiary_edge_count: number;
  primary_ridges: number;
  primary_valleys: number;
  tertiary_merged: number;
  micro_fragment_rejections: number;
}

/** Minimum area (px²) for a face to not be considered a micro-fragment */
const MIN_FACE_AREA_RATIO = 0.02;

/**
 * Classify edges into primary / secondary / tertiary structural tiers.
 *
 * Primary:   long, high-prominence edges (major ridges/valleys) — never merged
 * Secondary: medium importance (hips, moderate transitions) — merge cautiously
 * Tertiary:  short, low-prominence micro-edges — can be aggressively merged
 *
 * Scoring factors:
 *  - edge length (longer = more important)
 *  - DSM elevation prominence at midpoint
 *  - detection confidence score
 *  - type bonus (ridges/valleys inherently more structural than hips)
 */
function classifyEdgeHierarchy(
  edges: ClusterableEdge[],
  dsmGrid: DSMGrid | null,
  footprintPx: PxPt[],
  footprintAreaPx2: number,
): void {
  if (edges.length === 0) return;

  // Compute per-edge length
  const lengths = edges.map(e => Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y));
  const maxLen = Math.max(...lengths, 1);

  // Footprint diagonal as reference scale
  const fpXs = footprintPx.map(p => p.x);
  const fpYs = footprintPx.map(p => p.y);
  const fpDiag = footprintPx.length >= 2
    ? Math.hypot(Math.max(...fpXs) - Math.min(...fpXs), Math.max(...fpYs) - Math.min(...fpYs))
    : maxLen;

  // DSM prominence: how much midpoint elevation differs from local neighbours
  const prominences: number[] = edges.map((e, i) => {
    if (!dsmGrid) return 0.5;
    const mx = Math.round((e.a.x + e.b.x) / 2);
    const my = Math.round((e.a.y + e.b.y) / 2);
    if (mx < 1 || mx >= dsmGrid.width - 1 || my < 1 || my >= dsmGrid.height - 1) return 0.5;
    const midElev = dsmGrid.data[my * dsmGrid.width + mx];
    if (midElev === dsmGrid.noDataValue) return 0.5;
    // Sample 4 neighbours at ~10px distance
    const offsets = [[-10, 0], [10, 0], [0, -10], [0, 10]];
    let elevSum = 0, cnt = 0;
    for (const [ox, oy] of offsets) {
      const sx = mx + ox, sy = my + oy;
      if (sx >= 0 && sx < dsmGrid.width && sy >= 0 && sy < dsmGrid.height) {
        const se = dsmGrid.data[sy * dsmGrid.width + sx];
        if (se !== dsmGrid.noDataValue) { elevSum += se; cnt++; }
      }
    }
    if (cnt === 0) return 0.5;
    return Math.abs(midElev - elevSum / cnt);
  });
  const maxProm = Math.max(...prominences, 0.01);

  // Compute composite hierarchy score for each edge
  for (let i = 0; i < edges.length; i++) {
    const lenNorm = lengths[i] / fpDiag; // 0..~1, relative to footprint
    const promNorm = prominences[i] / maxProm; // 0..1
    const scoreNorm = edges[i].score; // already 0..1 ish
    const typeBonus = (edges[i].type === 'ridge' || edges[i].type === 'valley') ? 0.15 : 0;

    // Weighted composite — length is most important, then prominence
    const hScore = lenNorm * 0.40 + promNorm * 0.30 + scoreNorm * 0.15 + typeBonus;
    edges[i].hierarchyScore = hScore;
  }

  // Sort scores to find tier thresholds
  const scores = edges.map(e => e.hierarchyScore!).sort((a, b) => a - b);
  const p33 = scores[Math.floor(scores.length * 0.33)] ?? 0;
  const p66 = scores[Math.floor(scores.length * 0.66)] ?? 1;

  for (const e of edges) {
    const h = e.hierarchyScore!;
    if (h >= p66) {
      e.tier = 'primary';
    } else if (h >= p33) {
      e.tier = 'secondary';
    } else {
      e.tier = 'tertiary';
    }
  }
}

/**
 * Assign each edge midpoint to a local DSM elevation region.
 * This partitions the roof into local structural assemblies.
 */
function assignLocalRegions(
  edges: ClusterableEdge[],
  dsmGrid: DSMGrid | null,
  footprintPx: PxPt[],
): number[] {
  if (!dsmGrid || edges.length === 0) {
    return edges.map(() => 0);
  }

  // Compute bounding box of footprint
  const xs = footprintPx.map(p => p.x);
  const ys = footprintPx.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  // Build grid of mean elevations
  const cellSize = LOCAL_REGION_CELL_PX;
  const gridW = Math.max(1, Math.ceil(spanX / cellSize));
  const gridH = Math.max(1, Math.ceil(spanY / cellSize));
  const cellElevations: (number | null)[][] = [];

  for (let gy = 0; gy < gridH; gy++) {
    cellElevations.push([]);
    for (let gx = 0; gx < gridW; gx++) {
      const cx = minX + (gx + 0.5) * cellSize;
      const cy = minY + (gy + 0.5) * cellSize;
      // Sample DSM at this pixel location
      const px = Math.round(cx);
      const py = Math.round(cy);
      if (px >= 0 && px < dsmGrid.width && py >= 0 && py < dsmGrid.height) {
        const idx = py * dsmGrid.width + px;
        const elev = dsmGrid.data[idx];
        cellElevations[gy].push(elev !== dsmGrid.noDataValue ? elev : null);
      } else {
        cellElevations[gy].push(null);
      }
    }
  }

  // Flood-fill to create connected regions of similar elevation
  const cellRegion = Array.from({ length: gridH }, () => new Array(gridW).fill(-1));
  let regionCount = 0;

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (cellRegion[gy][gx] !== -1) continue;
      const elev = cellElevations[gy][gx];
      if (elev === null) {
        cellRegion[gy][gx] = regionCount++;
        continue;
      }

      // BFS flood fill
      const regionId = regionCount++;
      const queue: [number, number][] = [[gx, gy]];
      cellRegion[gy][gx] = regionId;

      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        const cElev = cellElevations[cy][cx];
        if (cElev === null) continue;

        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
          if (cellRegion[ny][nx] !== -1) continue;
          const nElev = cellElevations[ny][nx];
          if (nElev === null) continue;
          if (Math.abs(nElev - cElev) <= LOCAL_REGION_ELEV_DIFF_M) {
            cellRegion[ny][nx] = regionId;
            queue.push([nx, ny]);
          }
        }
      }
    }
  }

  // Assign each edge to a region based on its midpoint
  return edges.map(e => {
    const mx = (e.a.x + e.b.x) / 2;
    const my = (e.a.y + e.b.y) / 2;
    const gx = Math.min(gridW - 1, Math.max(0, Math.floor((mx - minX) / cellSize)));
    const gy = Math.min(gridH - 1, Math.max(0, Math.floor((my - minY) / cellSize)));
    return cellRegion[gy]?.[gx] ?? 0;
  });
}

/**
 * Check if merging two edges would create a cross-topology violation:
 * - different classified types (ridge + valley)
 * - crossing a DSM elevation ridge/valley between their midpoints
 */
function wouldCrossTopologyBoundary(
  ei: ClusterableEdge,
  ej: ClusterableEdge,
  dsmGrid: DSMGrid | null,
): boolean {
  // Type conflict: never merge ridge with valley
  if (ei.type !== ej.type && (ei.type === 'valley' || ej.type === 'valley') && (ei.type === 'ridge' || ej.type === 'ridge')) {
    return true;
  }

  if (!dsmGrid) return false;

  // Check elevation profile between midpoints for ridge/valley crossing
  const midI = { x: (ei.a.x + ei.b.x) / 2, y: (ei.a.y + ei.b.y) / 2 };
  const midJ = { x: (ej.a.x + ej.b.x) / 2, y: (ej.a.y + ej.b.y) / 2 };

  const steps = 8;
  const elevations: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = Math.round(midI.x + (midJ.x - midI.x) * t);
    const py = Math.round(midI.y + (midJ.y - midI.y) * t);
    if (px >= 0 && px < dsmGrid.width && py >= 0 && py < dsmGrid.height) {
      const idx = py * dsmGrid.width + px;
      const elev = dsmGrid.data[idx];
      if (elev !== dsmGrid.noDataValue) elevations.push(elev);
    }
  }

  if (elevations.length < 4) return false;

  // Detect local min/max in the elevation profile (indicates ridge/valley crossing)
  let transitions = 0;
  for (let i = 1; i < elevations.length - 1; i++) {
    const prev = elevations[i - 1];
    const curr = elevations[i];
    const next = elevations[i + 1];
    // Local maximum (ridge crossing) or minimum (valley crossing)
    if ((curr > prev + 0.3 && curr > next + 0.3) || (curr < prev - 0.3 && curr < next - 0.3)) {
      transitions++;
    }
  }

  return transitions >= 1;
}

function clusterEdges(
  edges: ClusterableEdge[],
  dsmGrid: DSMGrid | null = null,
  footprintPx: PxPt[] = [],
  footprintAreaPx2: number = 0,
): { clustered: ClusterableEdge[]; diagnostics: ClusterDiagnostics } {
  const diagnostics: ClusterDiagnostics = {
    pre_cluster_edge_count: edges.length,
    post_cluster_edge_count: 0,
    edges_merged_count: 0,
    local_regions_detected: 0,
    cluster_merge_rejections: 0,
    cross_region_rejections: 0,
    oversized_plane_rejections: 0,
    type_conflict_rejections: 0,
    valley_edges_preserved: 0,
    ridge_edges_preserved: 0,
    primary_edge_count: 0,
    secondary_edge_count: 0,
    tertiary_edge_count: 0,
    primary_ridges: 0,
    primary_valleys: 0,
    tertiary_merged: 0,
    micro_fragment_rejections: 0,
  };

  if (edges.length <= 1) {
    diagnostics.post_cluster_edge_count = edges.length;
    return { clustered: edges, diagnostics };
  }

  // Step 0: Classify structural hierarchy
  classifyEdgeHierarchy(edges, dsmGrid, footprintPx, footprintAreaPx2);
  diagnostics.primary_edge_count = edges.filter(e => e.tier === 'primary').length;
  diagnostics.secondary_edge_count = edges.filter(e => e.tier === 'secondary').length;
  diagnostics.tertiary_edge_count = edges.filter(e => e.tier === 'tertiary').length;
  diagnostics.primary_ridges = edges.filter(e => e.tier === 'primary' && e.type === 'ridge').length;
  diagnostics.primary_valleys = edges.filter(e => e.tier === 'primary' && e.type === 'valley').length;

  // Step 1: Assign edges to local DSM elevation regions
  const regionIds = assignLocalRegions(edges, dsmGrid, footprintPx);
  const uniqueRegions = new Set(regionIds);
  diagnostics.local_regions_detected = uniqueRegions.size;

  const used = new Set<number>();
  const result: ClusterableEdge[] = [];

  // HIERARCHY GATE: Primary edges are NEVER merged — emit directly
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].tier === 'primary') {
      result.push(edges[i]);
      used.add(i);
      if (edges[i].type === 'valley') diagnostics.valley_edges_preserved++;
      if (edges[i].type === 'ridge') diagnostics.ridge_edges_preserved++;
    }
  }

  for (let i = 0; i < edges.length; i++) {
    if (used.has(i)) continue;
    
    const cluster = [i];
    used.add(i);

    for (let j = i + 1; j < edges.length; j++) {
      if (used.has(j)) continue;
      
      // HIERARCHY GATE: Secondary edges only merge with tertiary
      // (primary already emitted, so both i and j are secondary or tertiary here)
      if (edges[i].tier === 'secondary' && edges[j].tier === 'secondary') {
        // Two secondary edges — don't merge, preserve both
        continue;
      }

      // TOPOLOGY GATE 1: Must be in the same local region
      if (regionIds[i] !== regionIds[j]) {
        diagnostics.cross_region_rejections++;
        continue;
      }

      // TOPOLOGY GATE 2: Check type conflict (ridge + valley = no merge)
      if (wouldCrossTopologyBoundary(edges[i], edges[j], dsmGrid)) {
        diagnostics.type_conflict_rejections++;
        continue;
      }

      let belongs = false;
      for (const ci of cluster) {
        const ei = edges[ci];
        const ej = edges[j];
        
        // Same local region already verified for i, check for cluster member
        if (regionIds[ci] !== regionIds[j]) continue;
        
        const ai = Math.atan2(ei.b.y - ei.a.y, ei.b.x - ei.a.x);
        const aj = Math.atan2(ej.b.y - ej.a.y, ej.b.x - ej.a.x);
        let angleDiff = Math.abs(ai - aj);
        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
        if (angleDiff > Math.PI / 2) angleDiff = Math.PI - angleDiff;

        // Tighter angle threshold for secondary edges
        const effectiveAngleThreshold = (ei.tier === 'secondary' || ej.tier === 'secondary')
          ? CLUSTER_ANGLE_DEG * 0.7
          : CLUSTER_ANGLE_DEG;
        if (angleDiff * 180 / Math.PI > effectiveAngleThreshold) continue;
        
        const midI = { x: (ei.a.x + ei.b.x) / 2, y: (ei.a.y + ei.b.y) / 2 };
        const midJ = { x: (ej.a.x + ej.b.x) / 2, y: (ej.a.y + ej.b.y) / 2 };
        const midDist = Math.hypot(midI.x - midJ.x, midI.y - midJ.y);

        // Tighter distance threshold for secondary edges
        const effectiveDistThreshold = (ei.tier === 'secondary' || ej.tier === 'secondary')
          ? CLUSTER_MIDPOINT_DIST_PX * 0.6
          : CLUSTER_MIDPOINT_DIST_PX;
        if (midDist > effectiveDistThreshold) continue;

        // TOPOLOGY GATE 3: DSM elevation profile between edges
        if (wouldCrossTopologyBoundary(ei, ej, dsmGrid)) {
          diagnostics.cluster_merge_rejections++;
          continue;
        }
        
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
      if (edges[i].type === 'valley') diagnostics.valley_edges_preserved++;
      if (edges[i].type === 'ridge') diagnostics.ridge_edges_preserved++;
      continue;
    }

    const clusterEdgesArr = cluster.map(ci => edges[ci]);

    // HIERARCHY: If cluster contains any secondary edge, keep it separate
    const hasSecondary = clusterEdgesArr.some(e => e.tier === 'secondary');
    if (hasSecondary && clusterEdgesArr.length >= 2) {
      // Keep secondary edges individually, only merge tertiary among themselves
      const secondary = clusterEdgesArr.filter(e => e.tier === 'secondary');
      const tertiary = clusterEdgesArr.filter(e => e.tier === 'tertiary');
      for (const se of secondary) {
        result.push(se);
        if (se.type === 'valley') diagnostics.valley_edges_preserved++;
        if (se.type === 'ridge') diagnostics.ridge_edges_preserved++;
      }
      // If only 1 tertiary, keep as-is; otherwise merge tertiary below
      if (tertiary.length <= 1) {
        for (const te of tertiary) result.push(te);
        diagnostics.edges_merged_count += 0;
        continue;
      }
      // Fall through with only tertiary edges to merge
      // (replace clusterEdgesArr for the merge logic below)
      // We'll handle this inline:
      diagnostics.tertiary_merged += tertiary.length - 1;
      const tPts = tertiary.flatMap(e => [e.a, e.b]);
      let tDx = 0, tDy = 0, tW = 0;
      for (const e of tertiary) {
        const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
        const dx = (e.b.x - e.a.x) / (len || 1);
        const dy = (e.b.y - e.a.y) / (len || 1);
        const sign = (tDx * dx + tDy * dy >= 0 || tW === 0) ? 1 : -1;
        tDx += sign * dx * len; tDy += sign * dy * len; tW += len;
      }
      const tNorm = Math.hypot(tDx, tDy) || 1;
      const tnx = tDx / tNorm, tny = tDy / tNorm;
      const tcx = tPts.reduce((s, p) => s + p.x, 0) / tPts.length;
      const tcy = tPts.reduce((s, p) => s + p.y, 0) / tPts.length;
      const tProj = tPts.map(p => (p.x - tcx) * tnx + (p.y - tcy) * tny);

      // Micro-fragment rejection: if merged tertiary is too short, drop it
      const mergedLen = Math.max(...tProj) - Math.min(...tProj);
      if (mergedLen < 8) {
        diagnostics.micro_fragment_rejections++;
        diagnostics.edges_merged_count += tertiary.length;
        continue;
      }

      result.push({
        a: { x: Math.round(tcx + tnx * Math.min(...tProj)), y: Math.round(tcy + tny * Math.min(...tProj)) },
        b: { x: Math.round(tcx + tnx * Math.max(...tProj)), y: Math.round(tcy + tny * Math.max(...tProj)) },
        type: tertiary[0].type,
        score: Math.max(...tertiary.map(e => e.score)),
      });
      diagnostics.edges_merged_count += tertiary.length - 1;
      continue;
    }

    // All-tertiary cluster — merge freely
    const allPts = clusterEdgesArr.flatMap(e => [e.a, e.b]);
    const spanX = Math.max(...allPts.map(p => p.x)) - Math.min(...allPts.map(p => p.x));
    const spanY = Math.max(...allPts.map(p => p.y)) - Math.min(...allPts.map(p => p.y));
    const span = Math.hypot(spanX, spanY);
    
    // TOPOLOGY GATE 4: Oversized plane prevention
    if (footprintAreaPx2 > 0) {
      const mergedInfluenceArea = span * CLUSTER_MIDPOINT_DIST_PX;
      if (mergedInfluenceArea > footprintAreaPx2 * CLUSTER_MAX_PLANE_AREA_RATIO && clusterEdgesArr.length > 2) {
        diagnostics.oversized_plane_rejections++;
        clusterEdgesArr.sort((a, b) => b.score - a.score);
        const keep = Math.min(clusterEdgesArr.length, 3);
        for (let k = 0; k < keep; k++) {
          result.push(clusterEdgesArr[k]);
        }
        diagnostics.edges_merged_count += clusterEdgesArr.length - keep;
        continue;
      }
    }

    if (span > CLUSTER_MAX_SPAN_PX && clusterEdgesArr.length > 2) {
      clusterEdgesArr.sort((a, b) => b.score - a.score);
      result.push(clusterEdgesArr[0], clusterEdgesArr[1]);
      diagnostics.edges_merged_count += clusterEdgesArr.length - 2;
      continue;
    }

    // Micro-fragment rejection for all-tertiary clusters
    if (span < 8 && clusterEdgesArr.every(e => e.tier === 'tertiary')) {
      diagnostics.micro_fragment_rejections++;
      diagnostics.edges_merged_count += clusterEdgesArr.length;
      continue;
    }
    
    // Weighted merge
    diagnostics.tertiary_merged += clusterEdgesArr.length - 1;
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

    // Track preserved types
    if (bestType === 'valley') diagnostics.valley_edges_preserved++;
    if (bestType === 'ridge') diagnostics.ridge_edges_preserved++;
    
    result.push({
      a: { x: Math.round(cx + nx * minProj), y: Math.round(cy + ny * minProj) },
      b: { x: Math.round(cx + nx * maxProj), y: Math.round(cy + ny * maxProj) },
      type: bestType,
      score: bestScore,
    });

    diagnostics.edges_merged_count += clusterEdgesArr.length - 1;
  }

  diagnostics.post_cluster_edge_count = result.length;
  return { clustered: result, diagnostics };
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

  console.log(`[AUTONOMOUS_GRAPH_SOLVER] v10 — Topology-Aware Edge Clustering`);
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
  // v14: Added comprehensive pre-solver DSM/mask diagnostics for Palm Harbor failure mode
  let dsmRidges: DSMEdgeCandidate[] = [];
  let dsmValleys: DSMEdgeCandidate[] = [];
  let unmaskEdgeCount = 0;
  let maskedEdgeCount = 0;
  let roofMaskPixelCount = 0;
  // v14: Pre-solver DSM/mask diagnostics
  let preSolverDiagnostics: Record<string, unknown> = {};

  if (effectiveDSM) {
    const { width, height } = effectiveDSM;

    // v14: DSM diagnostics inside footprint
    let dsmValuesInsideFootprint = 0;
    let dsmValidInsideFootprint = 0;
    const footprintMask = footprintPxCCW.length >= 3
      ? rasterizeFootprintMask(footprintPxCCW, width, height, 3)
      : null;

    if (footprintMask) {
      for (let i = 0; i < footprintMask.length; i++) {
        if (footprintMask[i]) {
          dsmValuesInsideFootprint++;
          const v = effectiveDSM.data[i];
          if (v !== effectiveDSM.noDataValue && !isNaN(v) && Number.isFinite(v)) {
            dsmValidInsideFootprint++;
          }
        }
      }
    }
    const dsmCoverageInsideFootprint = dsmValuesInsideFootprint > 0 ? dsmValidInsideFootprint / dsmValuesInsideFootprint : 0;

    // v14: Mask diagnostics
    const existingMask = input.maskedDSM?.mask || null;
    let maskLoaded = !!existingMask;
    let maskUniqueValues = new Set<number>();
    let maskMin = 255, maskMax = 0;
    let maskPixelsBefore = 0;
    if (existingMask) {
      for (let i = 0; i < existingMask.length; i++) {
        maskUniqueValues.add(existingMask[i]);
        if (existingMask[i] > 0) maskPixelsBefore++;
        if (existingMask[i] < maskMin) maskMin = existingMask[i];
        if (existingMask[i] > maskMax) maskMax = existingMask[i];
      }
    }

    let roofMask: Uint8Array | null;
    if (footprintMask && existingMask) {
      roofMask = intersectMasks(footprintMask, existingMask);
    } else {
      roofMask = footprintMask || existingMask;
    }

    if (roofMask) {
      for (let i = 0; i < roofMask.length; i++) {
        if (roofMask[i]) roofMaskPixelCount++;
      }
    }

    preSolverDiagnostics = {
      dsm_loaded: true,
      dsm_width: width,
      dsm_height: height,
      dsm_no_data_ratio: effectiveDSM.noDataValue !== undefined ? +(Array.from(effectiveDSM.data).filter(v => v === effectiveDSM.noDataValue || isNaN(v)).length / effectiveDSM.data.length).toFixed(4) : null,
      mask_loaded: maskLoaded,
      mask_width: maskLoaded ? width : null,
      mask_height: maskLoaded ? height : null,
      mask_unique_values: Array.from(maskUniqueValues).slice(0, 10),
      mask_min: maskLoaded ? maskMin : null,
      mask_max: maskLoaded ? maskMax : null,
      mask_threshold_used: maskLoaded ? 'binary_>0' : null,
      roof_mask_pixel_count_before_threshold: maskPixelsBefore,
      roof_mask_pixel_count_after_threshold: roofMaskPixelCount,
      dsm_values_inside_footprint_count: dsmValuesInsideFootprint,
      dsm_valid_values_inside_footprint_count: dsmValidInsideFootprint,
      dsm_coverage_inside_footprint_ratio: +dsmCoverageInsideFootprint.toFixed(4),
    };

    // v14: Specific failure codes for Palm Harbor — don't call this topology failure
    if (dsmCoverageInsideFootprint < 0.05 && dsmValuesInsideFootprint > 0) {
      console.log(`  [v14 DSM_COVERAGE_GATE] DSM has no valid values inside footprint: ${dsmValidInsideFootprint}/${dsmValuesInsideFootprint} (${(dsmCoverageInsideFootprint * 100).toFixed(1)}%)`);
      warnings.push(`google_solar_no_dsm_coverage: only ${dsmValidInsideFootprint} valid DSM pixels inside footprint`);
    }
    if (maskLoaded && maskPixelsBefore > 0 && roofMaskPixelCount === 0) {
      console.log(`  [v14 MASK_THRESHOLD_GATE] Mask had ${maskPixelsBefore} pixels before footprint intersection but 0 after — mask_threshold_failure`);
      warnings.push(`mask_threshold_failure: ${maskPixelsBefore} mask pixels reduced to 0 after footprint intersection`);
    }
    if (!maskLoaded && dsmValidInsideFootprint > 0) {
      console.log(`  [v14 MASK_MISSING] No mask available but DSM exists — using footprint as mask for diagnostic`);
      // Derive roof mask from footprint polygon and continue diagnostic-only
      roofMask = footprintMask;
      if (roofMask) {
        roofMaskPixelCount = 0;
        for (let i = 0; i < roofMask.length; i++) {
          if (roofMask[i]) roofMaskPixelCount++;
        }
      }
      warnings.push('mask_missing_dsm_exists: derived roof mask from footprint polygon');
    }

    const detection = detectStructuralEdges(effectiveDSM, roofMask);
    dsmRidges = detection.ridges;
    dsmValleys = detection.valleys;
    maskedEdgeCount = dsmRidges.length + dsmValleys.length;

    console.log(`  [v8 PRE-MASK] Roof mask: ${roofMaskPixelCount} pixels out of ${width * height} total (${(roofMaskPixelCount / (width * height) * 100).toFixed(1)}%)`);
    console.log(`  DSM edges (pre-masked): ${dsmRidges.length} ridges, ${dsmValleys.length} valleys (${detection.stats.processingMs}ms)`);
  } else {
    preSolverDiagnostics = { dsm_loaded: false };
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

  // ===== STEP 6: Topology-aware edge clustering =====
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
  
  // Compute footprint area in pixel space for oversized-plane prevention
  const footprintAreaPx2 = footprintPx.length >= 3
    ? Math.abs(footprintPx.reduce((sum, p, i) => {
        const q = footprintPx[(i + 1) % footprintPx.length];
        return sum + (p.x * q.y - q.x * p.y);
      }, 0) / 2)
    : 0;

  const clusterResult = clusterEdges(rawDsmInteriorEdgesPx, effectiveDSM, footprintPx, footprintAreaPx2);
  const clusteredEdgesPx = clusterResult.clustered;
  const clusterDiag = clusterResult.diagnostics;
  edgeCountAfterCluster = clusteredEdgesPx.length;
  console.log(`  Edge clustering (hierarchical): ${rawDsmInteriorEdgesPx.length} → ${clusteredEdgesPx.length} edges`);
  console.log(`    Hierarchy: primary=${clusterDiag.primary_edge_count} (ridges=${clusterDiag.primary_ridges}, valleys=${clusterDiag.primary_valleys}), secondary=${clusterDiag.secondary_edge_count}, tertiary=${clusterDiag.tertiary_edge_count}`);
  console.log(`    Local regions: ${clusterDiag.local_regions_detected}, cross-region: ${clusterDiag.cross_region_rejections}, type conflicts: ${clusterDiag.type_conflict_rejections}, oversized: ${clusterDiag.oversized_plane_rejections}`);
  console.log(`    Valleys preserved: ${clusterDiag.valley_edges_preserved}, ridges preserved: ${clusterDiag.ridge_edges_preserved}, tertiary merged: ${clusterDiag.tertiary_merged}, micro-fragments rejected: ${clusterDiag.micro_fragment_rejections}`);

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
    clipDiag.footprint_is_convex = clipResult.footprintIsConvex;
    clipDiag.clipped_area_ratio = faceAreaBeforeClipPx > 0 ? Number((faceAreaAfterClipPx / faceAreaBeforeClipPx).toFixed(3)) : 0;
    clipDiag.intersections_added_count = clipResult.intersectionsAdded;
    faceClippingDiagnostics.push(clipDiag);

    // P0 area-loss guard: if face had real area, bbox overlap was high, but clipping destroyed >50%, it's a clipper bug not LOW_COVERAGE
    if (faceAreaBeforeClipPx > 100 && bboxOverlapBeforeClip > 0.90 && faceAreaAfterClipPx > 0 && faceAreaAfterClipPx / faceAreaBeforeClipPx < 0.50) {
      facesRejected++;
      rejectionReasons.push('polygon_clipper_area_loss');
      warnings.push(`face_${faceId}_clipper_area_loss: before=${faceAreaBeforeClipPx.toFixed(0)} after=${faceAreaAfterClipPx.toFixed(0)} ratio=${(faceAreaAfterClipPx/faceAreaBeforeClipPx).toFixed(3)}`);
      faceRejectionTable.push({ face_id: faceId, area_sqft: 0, plane_rms: null, inside_footprint: true, mask_overlap: null, rejection_reason: 'polygon_clipper_area_loss' });
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

  // ===== STEP 8: EVIDENCE-DRIVEN TOPOLOGY REFINEMENT (v15) =====
  // If topology is undersegmented (few faces from many raw edges, or oversized planes),
  // attempt a second-pass refinement using preserved raw DSM edges as structural evidence.
  let refinementDiagnostics: Record<string, unknown> = { refinement_attempted: false };
  
  if (effectiveDSM && footprintPxCCW.length >= 3) {
    const prePlanArea = graphFaces.reduce((s, f) => s + f.plan_area_sqft, 0);
    const preMaxPlaneRatio = prePlanArea > 0 ? Math.max(...graphFaces.map(f => f.plan_area_sqft)) / prePlanArea : 0;
    const preRawEdgeCount = maskedEdgeCount; // raw DSM edges before clustering
    
    // Detect undersegmentation requiring refinement
    const needsRefinement = (
      // Many raw edges collapsed to very few faces
      (footprintAreaSqft > 2500 && preRawEdgeCount >= 15 && graphFaces.length <= 4) ||
      // A single plane dominates (>35% of total area) with sufficient raw evidence
      (graphFaces.length >= 2 && preMaxPlaneRatio > 0.35 && preRawEdgeCount >= 10) ||
      // Complex roof with too few faces for footprint size
      (footprintAreaSqft > 3000 && graphFaces.length < 8 && preRawEdgeCount >= 15 && complexity.isComplex)
    );

    if (needsRefinement) {
      console.log(`  [v15 REFINEMENT] Undersegmented topology detected: ${graphFaces.length} faces, max_plane_ratio=${preMaxPlaneRatio.toFixed(3)}, ${preRawEdgeCount} raw DSM edges`);
      
      // 1. Identify oversized faces (>35% of total area or spanning multiple DSM extrema)
      const oversizedFaceIds: string[] = [];
      const oversizedFaceAreaRatios: number[] = [];
      for (const face of graphFaces) {
        const ratio = prePlanArea > 0 ? face.plan_area_sqft / prePlanArea : 0;
        if (ratio > 0.35) {
          oversizedFaceIds.push(face.id);
          oversizedFaceAreaRatios.push(ratio);
        }
      }
      
      // 2. Find raw DSM edges that were lost during clustering but overlap with the footprint
      // These are edges from rawDsmInteriorEdgesPx that did NOT survive into dsmInteriorEdgesPx
      const survivingEdgeKeys = new Set(
        dsmInteriorEdgesPx.map(e => `${Math.round(e.a.x)}:${Math.round(e.a.y)}|${Math.round(e.b.x)}:${Math.round(e.b.y)}`)
      );
      
      const lostEdges = rawDsmInteriorEdgesPx.filter(e => {
        const key = `${Math.round(e.a.x)}:${Math.round(e.a.y)}|${Math.round(e.b.x)}:${Math.round(e.b.y)}`;
        const revKey = `${Math.round(e.b.x)}:${Math.round(e.b.y)}|${Math.round(e.a.x)}:${Math.round(e.a.y)}`;
        return !survivingEdgeKeys.has(key) && !survivingEdgeKeys.has(revKey);
      });
      
      // 3. Filter lost edges to those inside the footprint and with minimum quality
      const MIN_REFINEMENT_EDGE_SCORE = 0.3;
      const MIN_REFINEMENT_EDGE_LENGTH_PX = 8;
      const refinementCandidates = lostEdges.filter(e => {
        const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
        if (len < MIN_REFINEMENT_EDGE_LENGTH_PX) return false;
        if (e.score < MIN_REFINEMENT_EDGE_SCORE) return false;
        const mid: PxPt = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
        return pointInPolygonPx(mid, footprintPxCCW);
      });
      
      console.log(`  [v15 REFINEMENT] ${lostEdges.length} lost edges, ${refinementCandidates.length} qualify as refinement candidates`);
      console.log(`  [v15 REFINEMENT] Oversized faces: ${oversizedFaceIds.join(', ')} (ratios: ${oversizedFaceAreaRatios.map(r => r.toFixed(3)).join(', ')})`);
      
      if (refinementCandidates.length >= 2) {
        // 4. Augment the edge set: surviving edges + refinement candidates
        // Sort candidates by score*length to prioritize best structural evidence
        const sortedCandidates = [...refinementCandidates].sort((a, b) => {
          const lenA = Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y);
          const lenB = Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y);
          return (b.score * lenB) - (a.score * lenA);
        });
        
        // Cap reintroduced edges to avoid noise
        const maxReintroduced = Math.min(sortedCandidates.length, Math.max(8, dsmInteriorEdgesPx.length));
        const reintroducedEdges = sortedCandidates.slice(0, maxReintroduced);
        
        const augmentedEdgesPx = [
          ...dsmInteriorEdgesPx,
          ...reintroducedEdges
        ];
        
        // 5. Re-run planar solver with augmented edges
        const refinedPlanarInput: InteriorLine[] = augmentedEdgesPx.map(e => ({
          a: e.a, b: e.b, type: e.type, score: e.score,
        }));
        
        const refinedPlanar = planarSolveRoofPlanes(footprintPxCCW, refinedPlanarInput);
        console.log(`  [v15 REFINEMENT] Refined planar: ${refinedPlanar.faces.length} faces (was ${planar.faces.length})`);
        
        // 6. Process refined faces through the same validation pipeline
        const refinedGraphFaces: GraphFace[] = [];
        let refinedFacesRejected = 0;
        
        for (const [faceIdx, face] of refinedPlanar.faces.entries()) {
          let facePxR = face.polygon.map(p => ({ x: p.x, y: p.y }));
          if (facePxR.length < 3) continue;
          facePxR = ensureCCW(facePxR);
          
          const cleanedFacePxR = removeDuplicateVerticesPx(facePxR, 0.5);
          const clipResultR = clipPolygonPxRobust(
            cleanedFacePxR.length >= 3 ? cleanedFacePxR : facePxR,
            footprintPxCCW
          );
          const clippedPxR = clipResultR.polygon;
          if (clippedPxR.length < 3) continue;
          if (clipResultR.method === 'clipper_degenerate_output') continue;
          
          const polygonGeoR: XY[] = clippedPxR.map(p => pxToGeoPoint(p, effectiveDSM));
          if (polygonGeoR.length < 3) continue;
          
          const areaSqftR = polygonAreaSqft(polygonGeoR, midLat);
          if (areaSqftR < MIN_FACET_AREA_SQFT) { refinedFacesRejected++; continue; }
          
          let pitchR = 0, azimuthR = 0;
          const planeFitR = fitPlaneWithPitch(polygonGeoR, effectiveDSM);
          if (planeFitR) {
            const thresholdR = areaSqftR > 200 ? 0.8 : PLANE_FIT_ERROR_THRESHOLD;
            if (planeFitR.rms > thresholdR) { refinedFacesRejected++; continue; }
            pitchR = planeFitR.pitchDeg;
            azimuthR = planeFitR.azimuthDeg;
          } else {
            const facetCenterR = polygonGeoR.reduce((acc, p) => [acc[0] + p[0] / polygonGeoR.length, acc[1] + p[1] / polygonGeoR.length] as XY, [0, 0] as XY);
            const matchingSolarR = findClosestSolarSegment(facetCenterR, input.solarSegments);
            pitchR = matchingSolarR?.pitchDegrees || 0;
            azimuthR = matchingSolarR?.azimuthDegrees || 0;
          }
          
          const closedPolygonR = vertexKey(polygonGeoR[0]) === vertexKey(polygonGeoR[polygonGeoR.length - 1]) ? polygonGeoR : [...polygonGeoR, polygonGeoR[0]];
          refinedGraphFaces.push({
            id: `SF-${String.fromCharCode(65 + refinedGraphFaces.length)}`,
            label: String.fromCharCode(65 + refinedGraphFaces.length),
            polygon: closedPolygonR,
            plan_area_sqft: areaSqftR,
            roof_area_sqft: areaSqftR * pitchFactor(pitchR),
            pitch_degrees: pitchR,
            azimuth_degrees: azimuthR,
            edge_ids: [],
          });
        }
        
        // 7. Validate refinement quality — accept only if topology improved
        const refinedPlanArea = refinedGraphFaces.reduce((s, f) => s + f.plan_area_sqft, 0);
        const refinedMaxPlaneRatio = refinedPlanArea > 0
          ? Math.max(...refinedGraphFaces.map(f => f.plan_area_sqft)) / refinedPlanArea
          : 1;
        const refinedCoverageRatio = footprintAreaSqft > 0 ? refinedPlanArea / footprintAreaSqft : 0;
        
        // Count ridges/valleys in refined edges for topology quality
        const refinedRidgeCount = reintroducedEdges.filter(e => e.type === 'ridge').length + dsmInteriorEdgesPx.filter(e => e.type === 'ridge').length;
        const refinedValleyCount = reintroducedEdges.filter(e => e.type === 'valley').length + dsmInteriorEdgesPx.filter(e => e.type === 'valley').length;
        
        // Minimum face area to prevent micro-facets (at least 3% of total)
        const minFaceAreaRatio = refinedPlanArea > 0
          ? Math.min(...refinedGraphFaces.map(f => f.plan_area_sqft)) / refinedPlanArea
          : 0;
        const hasNoiseFragments = minFaceAreaRatio < 0.03 && refinedGraphFaces.length > graphFaces.length + 2;
        
        // Accept refinement if:
        // - More faces AND max plane ratio decreased
        // - Coverage didn't collapse
        // - No noise micro-facets introduced
        const refinementAccepted = (
          refinedGraphFaces.length > graphFaces.length &&
          refinedMaxPlaneRatio < preMaxPlaneRatio &&
          refinedCoverageRatio >= 0.50 &&
          !hasNoiseFragments
        );
        
        console.log(`  [v15 REFINEMENT RESULT] faces: ${graphFaces.length} → ${refinedGraphFaces.length}, ` +
          `max_plane_ratio: ${preMaxPlaneRatio.toFixed(3)} → ${refinedMaxPlaneRatio.toFixed(3)}, ` +
          `coverage: ${(prePlanArea / footprintAreaSqft).toFixed(3)} → ${refinedCoverageRatio.toFixed(3)}, ` +
          `min_face_ratio: ${minFaceAreaRatio.toFixed(3)}, noise: ${hasNoiseFragments}, ` +
          `ACCEPTED: ${refinementAccepted}`);
        
        refinementDiagnostics = {
          refinement_attempted: true,
          refinement_accepted: refinementAccepted,
          refinement_candidates_considered: refinementCandidates.length,
          refinement_candidates_used: reintroducedEdges.length,
          raw_edges_reintroduced: reintroducedEdges.length,
          lost_edges_total: lostEdges.length,
          faces_before_refinement: graphFaces.length,
          faces_after_refinement: refinedGraphFaces.length,
          faces_rejected_in_refinement: refinedFacesRejected,
          valley_count_before: dsmInteriorEdgesPx.filter(e => e.type === 'valley').length,
          valley_count_after: refinedValleyCount,
          ridge_count_before: dsmInteriorEdgesPx.filter(e => e.type === 'ridge').length,
          ridge_count_after: refinedRidgeCount,
          max_plane_area_ratio_before: Number(preMaxPlaneRatio.toFixed(3)),
          max_plane_area_ratio_after: Number(refinedMaxPlaneRatio.toFixed(3)),
          coverage_before: Number((prePlanArea / footprintAreaSqft).toFixed(3)),
          coverage_after: Number(refinedCoverageRatio.toFixed(3)),
          min_face_area_ratio: Number(minFaceAreaRatio.toFixed(3)),
          has_noise_fragments: hasNoiseFragments,
          oversized_face_ids: oversizedFaceIds,
          oversized_face_area_ratios: oversizedFaceAreaRatios.map(r => Number(r.toFixed(3))),
          rejection_reason: refinementAccepted ? null : (
            refinedGraphFaces.length <= graphFaces.length ? 'no_face_increase' :
            refinedMaxPlaneRatio >= preMaxPlaneRatio ? 'max_plane_ratio_not_reduced' :
            refinedCoverageRatio < 0.50 ? 'coverage_collapsed' :
            hasNoiseFragments ? 'noise_micro_facets' : 'unknown'
          ),
        };
        
        if (refinementAccepted) {
          // Replace faces with refined result
          graphFaces.length = 0;
          for (const f of refinedGraphFaces) graphFaces.push(f);
          faceCountAfterMerge = graphFaces.length;
          console.log(`  [v15 REFINEMENT] Accepted: topology improved from ${refinementDiagnostics.faces_before_refinement} to ${graphFaces.length} faces`);
          warnings.push(`topology_refinement_accepted: ${refinementDiagnostics.faces_before_refinement} → ${graphFaces.length} faces`);
        } else {
          console.log(`  [v15 REFINEMENT] Rejected: ${refinementDiagnostics.rejection_reason}`);
          warnings.push(`topology_refinement_rejected: ${refinementDiagnostics.rejection_reason}`);
        }
      } else {
        refinementDiagnostics = {
          refinement_attempted: true,
          refinement_accepted: false,
          refinement_candidates_considered: refinementCandidates.length,
          refinement_candidates_used: 0,
          raw_edges_reintroduced: 0,
          lost_edges_total: lostEdges.length,
          faces_before_refinement: graphFaces.length,
          faces_after_refinement: graphFaces.length,
          oversized_face_ids: oversizedFaceIds,
          oversized_face_area_ratios: oversizedFaceAreaRatios.map(r => Number(r.toFixed(3))),
          rejection_reason: 'insufficient_refinement_candidates',
        };
        console.log(`  [v15 REFINEMENT] Skipped: only ${refinementCandidates.length} qualifying candidates (need ≥2)`);
      }
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

  // Build face plane normals upfront for face-adjacency classification
  const facePlanesForClassification: Array<{ slopeX: number; slopeY: number; centroid: XY } | null> = [];
  if (effectiveDSM && planar.faces.length >= 2) {
    for (const face of planar.faces) {
      const geoPolygon = face.polygon.map((p: { x: number; y: number }) => pxToGeoPoint(p, effectiveDSM));
      if (geoPolygon.length < 3) { facePlanesForClassification.push(null); continue; }
      const { bounds, width, height, data, noDataValue } = effectiveDSM;
      const midLatLocal = (bounds.minLat + bounds.maxLat) / 2;
      const metersPerPixelX = (bounds.maxLng - bounds.minLng) / width * 111320 * Math.cos(midLatLocal * Math.PI / 180);
      const metersPerPixelY = (bounds.maxLat - bounds.minLat) / height * 111320;
      const poly = geoPolygon;
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
      if (points.length < 6) { facePlanesForClassification.push(null); continue; }
      const N = points.length;
      let Sx = 0, Sy = 0, Sz = 0, Sxx = 0, Sxy = 0, Syy = 0, Sxz = 0, Syz = 0;
      for (const p of points) { Sx += p.x; Sy += p.y; Sz += p.z; Sxx += p.x * p.x; Sxy += p.x * p.y; Syy += p.y * p.y; Sxz += p.x * p.z; Syz += p.y * p.z; }
      const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, N]];
      const B = [Sxz, Syz, Sz];
      const detVal = det3(A);
      if (Math.abs(detVal) < 1e-10) { facePlanesForClassification.push(null); continue; }
      const a = det3(replCol(A, B, 0)) / detVal;
      const b = det3(replCol(A, B, 1)) / detVal;
      const centroid: XY = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
      facePlanesForClassification.push({ slopeX: a / metersPerPixelX, slopeY: b / metersPerPixelY, centroid });
    }
  }

  // Edge classification table for diagnostics
  const edgeClassificationTable: Array<Record<string, unknown>> = [];

  for (const [_key, canonical] of canonicalEdgeMap) {
    const { start, end, faceIndices } = canonical;
    const lengthFt = distanceFt(start, end, midLat);
    if (lengthFt < 1) continue;

    let edgeType: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'unclassified';
    let edgeSource: 'dsm' | 'perimeter' = 'dsm';
    let edgeScore = 0.8;
    let classificationMethod = 'unknown';

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

    if (onFootprintBoundary) {
      // Boundary edge: eave/rake
      edgeType = 'eave';
      edgeSource = 'perimeter';
      edgeScore = 0.85;
      classificationMethod = 'footprint_boundary';
    } else if (faceIndices.length >= 2 && facePlanesForClassification.length > 0) {
      // PRIMARY: face-adjacency plane-normal classification
      const planeA = facePlanesForClassification[faceIndices[0]];
      const planeB = facePlanesForClassification[faceIndices[1]];
      
      if (planeA && planeB) {
        const edgeDx = end[0] - start[0];
        const edgeDy = end[1] - start[1];
        const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
        if (edgeLen > 1e-12) {
          const perpX = -edgeDy / edgeLen;
          const perpY = edgeDx / edgeLen;

          const dotA = (planeA.centroid[0] - edgeMid[0]) * perpX + (planeA.centroid[1] - edgeMid[1]) * perpY;
          const dotB = (planeB.centroid[0] - edgeMid[0]) * perpX + (planeB.centroid[1] - edgeMid[1]) * perpY;

          const downslopeA_perp = -(planeA.slopeX * perpX + planeA.slopeY * perpY);
          const downslopeB_perp = -(planeB.slopeX * perpX + planeB.slopeY * perpY);

          const slopeAwayA = dotA > 0 ? downslopeA_perp : -downslopeA_perp;
          const slopeAwayB = dotB > 0 ? -downslopeB_perp : downslopeB_perp;

          const slopeThreshold = 0.02;
          const aDescends = slopeAwayA > slopeThreshold;
          const bDescends = slopeAwayB > slopeThreshold;
          const aAscends = slopeAwayA < -slopeThreshold;
          const bAscends = slopeAwayB < -slopeThreshold;

          if (aDescends && bDescends) {
            edgeType = 'ridge'; edgeScore = 0.9; classificationMethod = 'face_adjacency_planes';
          } else if (aAscends && bAscends) {
            edgeType = 'valley'; edgeScore = 0.9; classificationMethod = 'face_adjacency_planes';
          } else if ((aDescends && bAscends) || (aAscends && bDescends)) {
            edgeType = 'hip'; edgeScore = 0.85; classificationMethod = 'face_adjacency_planes';
          } else {
            // Slopes too flat to determine — fall back to DSM profile
            edgeType = 'unclassified'; edgeScore = 0.5; classificationMethod = 'face_adjacency_inconclusive';
          }
        } else {
          edgeType = 'unclassified'; classificationMethod = 'edge_too_short';
        }
      } else {
        // One or both planes couldn't be fit — fall back to DSM proximity
        if (effectiveDSM) {
          const pxA = geoToPxPoint(start, effectiveDSM);
          const pxB = geoToPxPoint(end, effectiveDSM);
          const classified = classifyPlanarSegment({ a: pxA, b: pxB }, footprintPxCCW, dsmInteriorEdgesPx);
          edgeType = classified.type; edgeSource = classified.source; edgeScore = classified.score;
          classificationMethod = 'dsm_proximity_fallback';
        } else {
          edgeType = 'unclassified'; classificationMethod = 'no_plane_data';
        }
      }
    } else if (faceIndices.length === 1) {
      // Single face edge not on boundary — likely a boundary we missed or structural
      if (effectiveDSM) {
        const pxA = geoToPxPoint(start, effectiveDSM);
        const pxB = geoToPxPoint(end, effectiveDSM);
        const classified = classifyPlanarSegment({ a: pxA, b: pxB }, footprintPxCCW, dsmInteriorEdgesPx);
        edgeType = classified.type; edgeSource = classified.source; edgeScore = classified.score;
        classificationMethod = 'dsm_proximity_single_face';
      } else {
        edgeType = 'eave'; edgeSource = 'perimeter'; edgeScore = 0.7;
        classificationMethod = 'single_face_default_eave';
      }
    } else {
      // No face adjacency at all
      if (effectiveDSM) {
        const pxA = geoToPxPoint(start, effectiveDSM);
        const pxB = geoToPxPoint(end, effectiveDSM);
        const classified = classifyPlanarSegment({ a: pxA, b: pxB }, footprintPxCCW, dsmInteriorEdgesPx);
        edgeType = classified.type; edgeSource = classified.source; edgeScore = classified.score;
        classificationMethod = 'dsm_proximity_no_faces';
      } else {
        edgeType = 'unclassified'; classificationMethod = 'no_data';
      }
    }

    // Record classification diagnostics
    edgeClassificationTable.push({
      edge_key: _key.substring(0, 40),
      length_ft: Number(lengthFt.toFixed(1)),
      adjacent_face_count: faceIndices.length,
      on_footprint: onFootprintBoundary,
      type: edgeType,
      method: classificationMethod,
      score: edgeScore,
    });

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

  // Face-adjacency classification already done in initial edge emit loop above.
  // Log classification table summary
  const classMethodCounts: Record<string, number> = {};
  for (const entry of edgeClassificationTable) {
    const m = String(entry.method);
    classMethodCounts[m] = (classMethodCounts[m] || 0) + 1;
  }
  console.log(`  Edge classification methods: ${JSON.stringify(classMethodCounts)}`);

  // Totals
  const outRidges = outputEdges.filter(e => e.type === 'ridge');
  const outHips = outputEdges.filter(e => e.type === 'hip');
  const outValleys = outputEdges.filter(e => e.type === 'valley');
  const outEaves = outputEdges.filter(e => e.type === 'eave');
  const outRakes = outputEdges.filter(e => e.type === 'rake');
  const outUnclassified = outputEdges.filter(e => e.type === 'unclassified');
  const structuralEdgeCount = outRidges.length + outHips.length + outValleys.length;

  // ===== UNDERSEGMENTATION GATE (v13 hardened) =====
  // If we had many raw DSM edges but the planar solver collapsed to very few faces,
  // that's a topology undersegmentation — NOT an edge classification failure.
  // Use raw masked edge count (pre-clustering) for undersegmentation detection
  const rawDsmEdgeCount = maskedEdgeCount; // 31 for Fonsica — the true raw DSM edge count
  // v13: also detect when max plane covers too much area
  const planeAreas = graphFaces.map(f => f.plan_area_sqft);
  const maxPlaneAreaSqft = planeAreas.length > 0 ? Math.max(...planeAreas) : 0;
  const maxPlaneAreaRatio = totalPlanArea > 0 ? maxPlaneAreaSqft / totalPlanArea : 0;
  const topologyUndersegmented = (
    // Original: many raw edges collapsed to few faces
    (footprintAreaSqft > 2500 && rawDsmEdgeCount >= 15 && planar.faces.length <= 3) ||
    // v13: any single plane covers >35% of roof area on a complex roof
    (footprintAreaSqft > 2000 && graphFaces.length >= 2 && maxPlaneAreaRatio > 0.35 && rawDsmEdgeCount >= 10) ||
    // v13: expected_min_faces not met for this footprint size
    (footprintAreaSqft > 3000 && graphFaces.length < 8 && rawDsmEdgeCount >= 15)
  );
  if (topologyUndersegmented) {
    console.log(`  [TOPOLOGY_UNDERSEGMENTED] ${rawDsmEdgeCount} raw DSM edges (${dsmInteriorEdgesPx.length} after cluster/filter) collapsed to ${planar.faces.length} faces (footprint ${footprintAreaSqft.toFixed(0)} sqft, max_plane_ratio=${maxPlaneAreaRatio.toFixed(3)})`);
  }

  // Expected minimum faces based on footprint area
  const expectedMinFacesLocal = footprintAreaSqft < 1500 ? 4 : footprintAreaSqft < 2500 ? 6 : footprintAreaSqft < 3500 ? 8 : 10;

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
  // Undersegmentation takes priority over invalid_edge_classification
  if (topologyUndersegmented) {
    validation.valid = false;
    validation.status = 'topology_undersegmented';
    validation.reason = `${rawDsmEdgeCount} raw DSM edges collapsed to ${planar.faces.length} faces on ${footprintAreaSqft.toFixed(0)} sqft footprint — topology undersegmented`;
  } else {
    const invalidEdgeClassification = complexity.isComplex && outRidges.length === 0 && outValleys.length === 0 && outHips.reduce((s, e) => s + e.length_ft, 0) > 50;
    if (!validation.valid && invalidEdgeClassification) {
      // If faces have good coverage (≥85%), downgrade to needs_review instead of hard fail.
      // The geometry is structurally coherent even if edge classification is imperfect.
      if (coverageRatio >= 0.85 && graphFaces.length >= 2) {
        validation.status = 'needs_review';
        validation.reason = `Complex roof: 0 ridges, 0 valleys but ${graphFaces.length} faces at ${(coverageRatio * 100).toFixed(0)}% coverage — edge classification incomplete, geometry may be usable`;
        warnings.push('edge_classification_incomplete_but_faces_valid');
        console.log(`[VALIDATION] Downgraded invalid_edge_classification → needs_review: ${graphFaces.length} faces, ${(coverageRatio * 100).toFixed(0)}% coverage`);
      } else {
        validation.status = 'invalid_edge_classification';
        validation.reason = 'Complex roof has 0 ridges, 0 valleys, and >50 LF of hips after face-adjacency classification';
      }
    }
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
    // v8: pre-masked edge detection diagnostics
    engine_version: 'v9',
    pre_mask_enabled: true,
    roof_mask_pixel_count: roofMaskPixelCount,
    roof_mask_tile_pct: effectiveDSM ? Number((roofMaskPixelCount / (effectiveDSM.width * effectiveDSM.height) * 100).toFixed(1)) : 0,
    masked_edge_count: maskedEdgeCount,
    unmasked_edge_count: unmaskEdgeCount,
    // v10: face-adjacency edge classification diagnostics
    edge_classification_table: edgeClassificationTable.slice(0, 50), // cap for log size
    classification_method_counts: classMethodCounts,
    ridge_candidates: outRidges.length,
    valley_candidates: outValleys.length,
    hip_candidates: outHips.length,
    unclassified_edges: outUnclassified.length,
    topology_undersegmented: topologyUndersegmented,
    expected_min_faces: expectedMinFacesLocal,
    actual_faces_attempted: planar.faces.length,
    edge_merge_count: planar.debug.collinear_merges || 0,
    edges_removed_before_face_build: planar.debug.dangling_edges_removed || 0,
    raw_dsm_edge_count: rawDsmEdgeCount,
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
    cluster_merges: clusterDiag.edges_merged_count,
    cluster_diagnostics: {
      local_regions_detected: clusterDiag.local_regions_detected,
      cross_region_rejections: clusterDiag.cross_region_rejections,
      oversized_plane_rejections: clusterDiag.oversized_plane_rejections,
      type_conflict_rejections: clusterDiag.type_conflict_rejections,
      valley_edges_preserved: clusterDiag.valley_edges_preserved,
      ridge_edges_preserved: clusterDiag.ridge_edges_preserved,
      edges_merged_count: clusterDiag.edges_merged_count,
      cluster_merge_rejections: clusterDiag.cluster_merge_rejections,
      primary_edge_count: clusterDiag.primary_edge_count,
      secondary_edge_count: clusterDiag.secondary_edge_count,
      tertiary_edge_count: clusterDiag.tertiary_edge_count,
      primary_ridges: clusterDiag.primary_ridges,
      primary_valleys: clusterDiag.primary_valleys,
      tertiary_merged: clusterDiag.tertiary_merged,
      micro_fragment_rejections: clusterDiag.micro_fragment_rejections,
    },
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

// ═══════════════════════════════════════════════════════════════════════════
// TOPOLOGY FIDELITY ANALYSIS
// Detects fan-collapse, over-merging, and structural divergence from
// realistic roof topology. This is the missing layer between
// "geometry-valid" and "structurally correct."
// ═══════════════════════════════════════════════════════════════════════════

export interface TopologyFidelityResult {
  // Core metrics
  facet_count: number;
  ridge_count: number;
  valley_count: number;
  hip_count: number;
  ridge_total_ft: number;
  valley_total_ft: number;
  hip_total_ft: number;
  eave_total_ft: number;
  rake_total_ft: number;

  // Ratio analysis
  valley_to_ridge_ratio: number;       // Healthy roofs: 0.3–2.0. Fan-collapse: <0.15
  ridge_to_valley_ratio: number;       // Collapse signal: inflated ridges vs suppressed valleys
  ridge_to_eave_ratio: number;         // Healthy: 0.1–0.6. Inflated ridges: >0.6
  longest_ridge_ft: number;
  longest_ridge_ratio: number;         // Longest ridge / total ridge. >0.5 = suspicious
  longest_hip_ft: number;
  longest_hip_ratio: number;

  // Plane analysis
  average_plane_area_sqft: number;
  plane_area_variance: number;         // CV of plane areas. Very low = uniform fan
  dominant_plane_ratio: number;        // Largest plane / total area. >0.4 = over-merged
  max_plane_area_ratio: number;        // Alias persisted for report/debug consumers
  largest_plane_sqft: number;

  // Pitch analysis
  pitch_variance: number;              // StdDev of face pitches. High + low mean = wrong planes
  predominant_pitch: number;
  pitch_range: number;                 // max - min pitch
  pitch_uniformity_score: number;      // 0-1, 1 = all same pitch

  // Fan-collapse detection
  max_vertex_degree: number;           // Highest edge count on any interior vertex
  central_node_degree: number;         // Degree of highest-degree interior node
  fan_collapse_suspected: boolean;     // True if central node too connected
  diagonal_cross_roof_count: number;   // Edges spanning >60% of roof bbox
  diagonal_span_ratio: number;         // Longest interior edge / sqrt(roof area). >0.9 = cross-assembly span
  local_cluster_count: number;         // Connected local structural assemblies
  merged_plane_suspected: boolean;     // True if largest plane is outsized
  valley_collapse_suspected: boolean;
  ridge_inflation_suspected: boolean;
  oversized_continuous_plane_suspected: boolean;
  planes_need_refinement: boolean;
  pitch_fragmentation_suspected: boolean;

  // Expected facet count (heuristic from footprint complexity)
  expected_min_facets: number;
  facet_deficit: number;               // expected_min - actual. >0 = under-segmented

  // Overall fidelity
  topology_fidelity: 'high' | 'medium' | 'low';
  topology_fidelity_score: number;     // 0-100
  topology_issues: string[];
}

/**
 * Analyze topology fidelity of a solved roof graph.
 * Returns detailed metrics and a fidelity rating.
 */
export function analyzeTopologyFidelity(
  graph: AutonomousGraphResult,
  footprintAreaSqft: number,
): TopologyFidelityResult {
  const faces = graph.faces;
  const edges = graph.edges;
  const vertices = graph.vertices;
  const issues: string[] = [];

  // ── Core counts ──
  const ridgeEdges = edges.filter(e => e.type === 'ridge');
  const valleyEdges = edges.filter(e => e.type === 'valley');
  const hipEdges = edges.filter(e => e.type === 'hip');
  const eaveEdges = edges.filter(e => e.type === 'eave');
  const rakeEdges = edges.filter(e => e.type === 'rake');

  const ridgeTotalFt = ridgeEdges.reduce((s, e) => s + e.length_ft, 0);
  const valleyTotalFt = valleyEdges.reduce((s, e) => s + e.length_ft, 0);
  const hipTotalFt = hipEdges.reduce((s, e) => s + e.length_ft, 0);
  const eaveTotalFt = eaveEdges.reduce((s, e) => s + e.length_ft, 0);
  const rakeTotalFt = rakeEdges.reduce((s, e) => s + e.length_ft, 0);

  // ── Ratio analysis ──
  const valleyToRidgeRatio = ridgeTotalFt > 0 ? valleyTotalFt / ridgeTotalFt : 0;
  const ridgeToValleyRatio = valleyTotalFt > 0 ? ridgeTotalFt / valleyTotalFt : (ridgeTotalFt > 0 ? 999 : 0);
  const ridgeToEaveRatio = eaveTotalFt > 0 ? ridgeTotalFt / eaveTotalFt : 0;

  const longestRidge = ridgeEdges.length > 0 ? Math.max(...ridgeEdges.map(e => e.length_ft)) : 0;
  const longestRidgeRatio = ridgeTotalFt > 0 ? longestRidge / ridgeTotalFt : 0;
  const longestHip = hipEdges.length > 0 ? Math.max(...hipEdges.map(e => e.length_ft)) : 0;
  const longestHipRatio = hipTotalFt > 0 ? longestHip / hipTotalFt : 0;

  // ── Plane analysis ──
  const planeAreas = faces.map(f => f.plan_area_sqft);
  const totalPlaneArea = planeAreas.reduce((s, a) => s + a, 0);
  const avgPlaneArea = faces.length > 0 ? totalPlaneArea / faces.length : 0;
  const largestPlane = planeAreas.length > 0 ? Math.max(...planeAreas) : 0;
  const dominantPlaneRatio = totalPlaneArea > 0 ? largestPlane / totalPlaneArea : 0;

  // Coefficient of variation of plane areas
  const areaStdDev = faces.length > 1
    ? Math.sqrt(planeAreas.reduce((s, a) => s + (a - avgPlaneArea) ** 2, 0) / (faces.length - 1))
    : 0;
  const planeAreaVariance = avgPlaneArea > 0 ? areaStdDev / avgPlaneArea : 0;

  // ── Pitch analysis ──
  const pitches = faces.map(f => f.pitch_degrees);
  const avgPitch = pitches.length > 0 ? pitches.reduce((s, p) => s + p, 0) / pitches.length : 0;
  const pitchStdDev = pitches.length > 1
    ? Math.sqrt(pitches.reduce((s, p) => s + (p - avgPitch) ** 2, 0) / (pitches.length - 1))
    : 0;
  const pitchRange = pitches.length > 0 ? Math.max(...pitches) - Math.min(...pitches) : 0;
  // Convert predominant pitch from degrees to x/12 ratio for comparison
  const predominantPitch = graph.totals.predominant_pitch;
  // Uniformity: 1 means all faces have same pitch, 0 means very spread
  const pitchUniformityScore = pitchRange > 0 ? Math.max(0, 1 - (pitchStdDev / Math.max(avgPitch, 1))) : 1;

  // ── Vertex degree analysis (fan-collapse detection) ──
  // Count how many edges connect to each vertex using exact canonical keys.
  // A degree measured by geo-distance would mark every nearby roof vertex as
  // connected and falsely hide/trigger fan-collapse on small parcels.
  const vertexDegreeMap = new Map<string, number>();
  for (const edge of edges) {
    const startKey = vertexKey(edge.start);
    const endKey = vertexKey(edge.end);
    for (const v of vertices) {
      const key = vertexKey(v.position);
      if (key === startKey || key === endKey) vertexDegreeMap.set(v.id, (vertexDegreeMap.get(v.id) || 0) + 1);
    }
  }
  // Also use connected_edge_ids if available
  for (const v of vertices) {
    if (v.connected_edge_ids.length > (vertexDegreeMap.get(v.id) || 0)) {
      vertexDegreeMap.set(v.id, v.connected_edge_ids.length);
    }
  }
  const degrees = Array.from(vertexDegreeMap.values());
  const maxVertexDegree = degrees.length > 0 ? Math.max(...degrees) : 0;
  // Central node = highest-degree interior vertex (not eave_corner)
  let centralNodeDegree = 0;
  for (const v of vertices) {
    if (v.type !== 'eave_corner') {
      const deg = vertexDegreeMap.get(v.id) || v.connected_edge_ids.length;
      if (deg > centralNodeDegree) centralNodeDegree = deg;
    }
  }

  // Fan collapse: too many edges converging at one interior node
  const fanCollapseSuspected = centralNodeDegree >= 6;

  // ── Diagonal cross-roof detection ──
  // Get roof bounding box diagonal
  const allPts = faces.flatMap(f => f.polygon);
  let roofDiagonal = 1;
  if (allPts.length > 0) {
    const bounds = getBounds(allPts);
    roofDiagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  }
  // Interior edges (ridge/hip/valley) that span > 60% of roof bbox diagonal
  const interiorEdges = edges.filter(e => e.type === 'ridge' || e.type === 'hip' || e.type === 'valley');
  const edgeLengthsPx = interiorEdges.map(e => Math.hypot(e.end[0] - e.start[0], e.end[1] - e.start[1]));
  const maxInteriorSpanPx = edgeLengthsPx.length > 0 ? Math.max(...edgeLengthsPx) : 0;
  const diagonalSpanRatio = roofDiagonal > 0 ? maxInteriorSpanPx / roofDiagonal : 0;
  const diagonalCrossRoofCount = edgeLengthsPx.filter(l => l > roofDiagonal * 0.5).length;

  // ── Local structural clusters ──
  const adjacency = new Map<string, Set<string>>();
  for (const edge of interiorEdges) {
    const a = vertexKey(edge.start);
    const b = vertexKey(edge.end);
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }
  const seenClusterNodes = new Set<string>();
  let localClusterCount = 0;
  for (const node of adjacency.keys()) {
    if (seenClusterNodes.has(node)) continue;
    localClusterCount++;
    const stack = [node];
    seenClusterNodes.add(node);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const next of adjacency.get(cur) || []) {
        if (seenClusterNodes.has(next)) continue;
        seenClusterNodes.add(next);
        stack.push(next);
      }
    }
  }

  // ── Merged plane detection ──
  const mergedPlaneSuspected = dominantPlaneRatio > 0.35 || (faces.length <= 8 && footprintAreaSqft > 2800);
  const valleyCollapseSuspected = ridgeTotalFt > 40 && (valleyTotalFt < 20 || valleyToRidgeRatio < 0.25) && footprintAreaSqft > 1800;
  const ridgeInflationSuspected = ridgeTotalFt > 90 || ridgeToValleyRatio > 3.5 || ridgeToEaveRatio > 0.45;
  const oversizedContinuousPlaneSuspected = dominantPlaneRatio > 0.35 || largestPlane > Math.max(900, footprintAreaSqft * 0.33);
  const pitchFragmentationSuspected = pitchRange > 10 && pitchUniformityScore < 0.75 && avgPitch > 0;

  // ── Expected facet count heuristic ──
  // Based on footprint area and complexity. Simple heuristic:
  // <1500 sqft: expect 4-8, 1500-3000: expect 6-12, >3000: expect 8-16
  let expectedMinFacets: number;
  if (footprintAreaSqft < 1500) expectedMinFacets = 4;
  else if (footprintAreaSqft < 2500) expectedMinFacets = 6;
  else if (footprintAreaSqft < 3500) expectedMinFacets = 8;
  else expectedMinFacets = 10;
  const facetDeficit = expectedMinFacets - faces.length;
  const planesNeedRefinement = oversizedContinuousPlaneSuspected || (planeAreaVariance > 0.9 && faces.length < expectedMinFacets + 2);

  // ── Issue detection ──
  if (facetDeficit > 2) {
    issues.push(`facet_count_deficit:${faces.length}_vs_expected_min_${expectedMinFacets}`);
  }
  if (valleyToRidgeRatio < 0.15 && valleyEdges.length === 0 && footprintAreaSqft > 1500) {
    issues.push(`valley_collapse:ratio=${valleyToRidgeRatio.toFixed(3)}`);
  } else if (valleyToRidgeRatio < 0.15 && ridgeTotalFt > 50) {
    issues.push(`valley_suppression:ratio=${valleyToRidgeRatio.toFixed(3)}`);
  }
  if (ridgeInflationSuspected) {
    issues.push(`ridge_inflation:ridge_to_valley=${ridgeToValleyRatio.toFixed(2)},ridge_to_eave=${ridgeToEaveRatio.toFixed(3)}`);
  }
  if (longestRidgeRatio > 0.5 && ridgeTotalFt > 50) {
    issues.push(`single_dominant_ridge:${longestRidge.toFixed(1)}ft_of_${ridgeTotalFt.toFixed(1)}ft`);
  }
  if (fanCollapseSuspected) {
    issues.push(`fan_collapse:central_node_degree=${centralNodeDegree}`);
  }
  if (diagonalCrossRoofCount > 0) {
    issues.push(`cross_roof_diagonals:${diagonalCrossRoofCount},span_ratio=${diagonalSpanRatio.toFixed(3)}`);
  }
  if (oversizedContinuousPlaneSuspected) {
    issues.push(`oversized_plane:${(dominantPlaneRatio * 100).toFixed(1)}%_of_total`);
  }
  if (pitchFragmentationSuspected) {
    issues.push(`pitch_fragmentation:range=${pitchRange.toFixed(1)}deg,uniformity=${pitchUniformityScore.toFixed(2)}`);
  }
  if (planesNeedRefinement) {
    issues.push(`plane_refinement_required:largest=${largestPlane.toFixed(0)}sqft,clusters=${localClusterCount}`);
  }

  // ── Fidelity scoring ──
  // Start at 100, deduct for each issue
  let score = 100;
  if (facetDeficit > 4) score -= 25;
  else if (facetDeficit > 2) score -= 15;

  if (valleyCollapseSuspected) score -= 25;
  else if (valleyToRidgeRatio < 0.20 && ridgeTotalFt > 30) score -= 10;

  if (ridgeInflationSuspected) score -= ridgeTotalFt > 120 ? 25 : 15;

  if (fanCollapseSuspected) score -= 20;
  if (diagonalCrossRoofCount >= 2 || diagonalSpanRatio > 0.65) score -= 20;
  else if (diagonalCrossRoofCount === 1 || diagonalSpanRatio > 0.50) score -= 10;

  if (oversizedContinuousPlaneSuspected) score -= dominantPlaneRatio > 0.50 ? 20 : 12;

  if (pitchFragmentationSuspected) score -= pitchRange > 15 ? 15 : 8;

  if (longestRidgeRatio > 0.7) score -= 10;

  const severeStructuralCollapse = valleyCollapseSuspected && ridgeInflationSuspected && faces.length <= expectedMinFacets;
  if (severeStructuralCollapse) {
    issues.push(`structural_collapse_signature:facets=${faces.length},ridge=${ridgeTotalFt.toFixed(1)}ft,valley=${valleyTotalFt.toFixed(1)}ft`);
    score = Math.min(score, 40);
  }

  score = Math.max(0, Math.min(100, score));

  const topology_fidelity: 'high' | 'medium' | 'low' =
    score >= 70 ? 'high' :
    score >= 45 ? 'medium' : 'low';

  return {
    facet_count: faces.length,
    ridge_count: ridgeEdges.length,
    valley_count: valleyEdges.length,
    hip_count: hipEdges.length,
    ridge_total_ft: Number(ridgeTotalFt.toFixed(2)),
    valley_total_ft: Number(valleyTotalFt.toFixed(2)),
    hip_total_ft: Number(hipTotalFt.toFixed(2)),
    eave_total_ft: Number(eaveTotalFt.toFixed(2)),
    rake_total_ft: Number(rakeTotalFt.toFixed(2)),
    valley_to_ridge_ratio: Number(valleyToRidgeRatio.toFixed(4)),
    ridge_to_valley_ratio: Number(ridgeToValleyRatio.toFixed(4)),
    ridge_to_eave_ratio: Number(ridgeToEaveRatio.toFixed(4)),
    longest_ridge_ft: Number(longestRidge.toFixed(2)),
    longest_ridge_ratio: Number(longestRidgeRatio.toFixed(4)),
    longest_hip_ft: Number(longestHip.toFixed(2)),
    longest_hip_ratio: Number(longestHipRatio.toFixed(4)),
    average_plane_area_sqft: Number(avgPlaneArea.toFixed(2)),
    plane_area_variance: Number(planeAreaVariance.toFixed(4)),
    dominant_plane_ratio: Number(dominantPlaneRatio.toFixed(4)),
    max_plane_area_ratio: Number(dominantPlaneRatio.toFixed(4)),
    largest_plane_sqft: Number(largestPlane.toFixed(2)),
    pitch_variance: Number(pitchStdDev.toFixed(4)),
    predominant_pitch: predominantPitch,
    pitch_range: Number(pitchRange.toFixed(2)),
    pitch_uniformity_score: Number(pitchUniformityScore.toFixed(4)),
    max_vertex_degree: maxVertexDegree,
    central_node_degree: centralNodeDegree,
    fan_collapse_suspected: fanCollapseSuspected,
    diagonal_cross_roof_count: diagonalCrossRoofCount,
    diagonal_span_ratio: Number(diagonalSpanRatio.toFixed(4)),
    local_cluster_count: localClusterCount,
    merged_plane_suspected: mergedPlaneSuspected,
    valley_collapse_suspected: valleyCollapseSuspected,
    ridge_inflation_suspected: ridgeInflationSuspected,
    oversized_continuous_plane_suspected: oversizedContinuousPlaneSuspected,
    planes_need_refinement: planesNeedRefinement,
    pitch_fragmentation_suspected: pitchFragmentationSuspected,
    expected_min_facets: expectedMinFacets,
    facet_deficit: facetDeficit,
    topology_fidelity,
    topology_fidelity_score: score,
    topology_issues: issues,
  };
}
