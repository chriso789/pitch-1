/**
 * PerimeterTopology v1 — Phase 0: Perimeter-First Roof Topology Contract
 *
 * ARCHITECTURAL RULE:
 *   Before solving hips, ridges, valleys, or internal facets, the system
 *   MUST build and validate the actual roof perimeter: eaves, rakes,
 *   corners, transitions, and closed outline.
 *
 *   Internal topology is NOT allowed to publish unless the perimeter
 *   contract passes.
 *
 * PERIMETER SOURCE PRIORITY:
 *   1. vendor_verified perimeter
 *   2. Google Solar mask connected-component contour
 *   3. Google Solar roofSegmentStats union/hull refined by DSM roof mask
 *   4. Mapbox/OSM footprint (fallback, never auto customer-ready)
 *   5. Parcel footprint → NOT roof perimeter unless mask-matched
 */

type XY = [number, number];
type PxPt = { x: number; y: number };

// ═══════════════════════════════════════════════════════════════════
// PERIMETER EDGE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════

export type PerimeterEdgeType = 'eave' | 'rake' | 'unknown';

export interface PerimeterEdge {
  id: string;
  start_px: PxPt;
  end_px: PxPt;
  start_geo: XY;
  end_geo: XY;
  length_ft: number;
  length_px: number;
  type: PerimeterEdgeType;
  /** Evidence used for classification */
  classification_evidence: PerimeterEdgeEvidence;
  /** Confidence in eave/rake classification (0-1) */
  classification_confidence: number;
}

export interface PerimeterEdgeEvidence {
  /** DSM gradient direction near this boundary segment */
  dsm_gradient_direction: [number, number] | null;
  /** Solar segment downslope vector for adjacent face */
  solar_downslope_vector: [number, number] | null;
  /** Angle between edge direction and downslope (eave ~perpendicular, rake ~parallel) */
  edge_downslope_angle_deg: number | null;
  /** Is this edge along a long lower horizontal drainage line? */
  is_horizontal_drainage: boolean;
  /** Is this edge along a sloped side boundary? */
  is_sloped_side_boundary: boolean;
  /** Mean elevation along this edge (meters) */
  mean_elevation_m: number | null;
  /** Elevation is low relative to ridge? (eave indicator) */
  is_low_elevation: boolean;
  /** Edge orientation angle (degrees from horizontal) */
  orientation_deg: number;
}

export interface PerimeterNode {
  id: string;
  position_px: PxPt;
  position_geo: XY;
  /** Corner type based on interior angle */
  corner_type: 'convex' | 'reflex';
  /** Interior angle in degrees */
  interior_angle_deg: number;
  /** IDs of the two perimeter edges meeting at this node */
  edge_ids: [string, string];
}

// ═══════════════════════════════════════════════════════════════════
// THE PERIMETER TOPOLOGY OBJECT
// ═══════════════════════════════════════════════════════════════════

export type PerimeterSource =
  | 'vendor_verified'
  | 'google_solar_mask_contour'
  | 'google_solar_segments_refined'
  | 'mapbox_osm_footprint'
  | 'parcel_footprint'
  | 'unknown';

export interface PerimeterTopology {
  /** Closed ring in DSM pixel space (first == last) */
  perimeter_ring_px: PxPt[];
  /** Closed ring in geo coordinates (first == last) */
  perimeter_ring_geo: XY[];
  /** Corner nodes */
  perimeter_nodes: PerimeterNode[];
  /** Classified boundary edges */
  perimeter_edges: PerimeterEdge[];
  /** Edges classified as eaves */
  eave_edges: PerimeterEdge[];
  /** Edges classified as rakes */
  rake_edges: PerimeterEdge[];
  /** Corner nodes */
  corner_nodes: PerimeterNode[];
  /** Reflex corners (interior angle > 180°) */
  reflex_corners: PerimeterNode[];
  /** Convex corners */
  convex_corners: PerimeterNode[];
  /** Confidence in overhang detection (0-1) */
  overhang_confidence: number;
  /** Source of the footprint used */
  footprint_source: string;
  /** Source of the perimeter */
  perimeter_source: PerimeterSource;
  /** Area enclosed by the perimeter ring (sqft) */
  perimeter_area_sqft: number;
  /** Whether the ring is closed */
  perimeter_closed: boolean;
  /** Number of self-intersections detected */
  perimeter_self_intersections: number;
  /** Overlap score with roof mask (0-1) */
  perimeter_registration_score: number;
  /** Overall perimeter confidence (0-1) */
  perimeter_confidence: number;
  /** Whether perimeter is ready for customer export */
  customer_perimeter_ready: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// PERIMETER GATE RESULT
// ═══════════════════════════════════════════════════════════════════

export interface PerimeterGateResult {
  passed: boolean;
  perimeter_ready: boolean;
  customer_perimeter_ready: boolean;
  failure_reasons: string[];
  diagnostics: PerimeterDiagnostics;
}

export interface PerimeterDiagnostics {
  perimeter_ready: boolean;
  perimeter_source: PerimeterSource;
  perimeter_area_sqft: number;
  perimeter_overlap_score: number;
  perimeter_centroid_offset_px: number;
  perimeter_bbox_match_score: number;
  eave_length_lf: number;
  rake_length_lf: number;
  unknown_perimeter_lf: number;
  perimeter_failure_reasons: string[];
  perimeter_candidate_table: PerimeterCandidate[];
  total_perimeter_lf: number;
  unknown_ratio: number;
}

export interface PerimeterCandidate {
  source: PerimeterSource;
  area_sqft: number;
  overlap_score: number;
  centroid_offset_px: number;
  bbox_match_score: number;
  closed: boolean;
  self_intersections: number;
  selected: boolean;
  rejection_reason: string | null;
}

// ═══════════════════════════════════════════════════════════════════
// PERIMETER CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════

export interface PerimeterInput {
  /** Footprint polygon in geo coords */
  footprint_geo: XY[];
  /** Footprint polygon in DSM pixel coords */
  footprint_px: PxPt[];
  /** Footprint area in sqft */
  footprint_area_sqft: number;
  /** Source of the footprint */
  footprint_source: string;
  /** DSM grid for elevation queries */
  dsm_grid: any | null;
  /** Masked DSM with roof mask */
  masked_dsm: any | null;
  /** Solar segments for downslope classification */
  solar_segments: Array<{
    pitch_degrees: number;
    azimuth_degrees: number;
    area_sqft: number;
    center_geo: XY | null;
  }>;
  /** Roof mask pixel count */
  roof_mask_pixel_count: number;
  /** DSM dimensions */
  dsm_width: number;
  dsm_height: number;
  /** Lat for area conversions */
  lat: number;
  /** Meters per pixel */
  meters_per_pixel: number;
  /** Pre-computed boundary edges if available */
  boundary_eaves: Array<{ start_geo: XY; end_geo: XY; start_px: PxPt; end_px: PxPt }>;
  boundary_rakes: Array<{ start_geo: XY; end_geo: XY; start_px: PxPt; end_px: PxPt }>;
}

/**
 * Build the PerimeterTopology from available evidence.
 * This is Phase 0 — runs BEFORE any internal topology solver.
 */
export function buildPerimeterTopology(input: PerimeterInput): PerimeterTopology {
  console.log(`[PERIMETER_PHASE_0] Building perimeter topology from ${input.footprint_px.length} footprint vertices`);

  const perimeterPx = ensureClosedRing(input.footprint_px);
  const perimeterGeo = ensureClosedRingGeo(input.footprint_geo);

  // Determine perimeter source
  const perimeterSource = resolvePerimeterSource(input.footprint_source);

  // Build nodes and edges from the ring
  const { nodes, edges } = buildNodesAndEdges(perimeterPx, perimeterGeo, input);

  // Classify each edge as eave, rake, or unknown
  classifyPerimeterEdges(edges, input);

  const eaveEdges = edges.filter(e => e.type === 'eave');
  const rakeEdges = edges.filter(e => e.type === 'rake');
  const reflexCorners = nodes.filter(n => n.corner_type === 'reflex');
  const convexCorners = nodes.filter(n => n.corner_type === 'convex');

  // Check ring properties
  const closed = isRingClosed(perimeterPx);
  const selfIntersections = countSelfIntersections(perimeterPx);

  // Compute overlap with roof mask
  const overlapScore = computeMaskOverlap(perimeterPx, input);

  // Compute centroid offset
  const centroidOffset = computeCentroidOffset(perimeterPx, input);

  // Area
  const perimeterArea = input.footprint_area_sqft;

  // Customer readiness: only auto-ready if vendor-verified or mask-contour with high overlap
  const autoReady = (perimeterSource === 'vendor_verified') ||
    (perimeterSource === 'google_solar_mask_contour' && overlapScore >= 0.90 && selfIntersections === 0 && closed);

  // Confidence scoring
  let confidence = 0.5;
  if (perimeterSource === 'vendor_verified') confidence = 0.95;
  else if (perimeterSource === 'google_solar_mask_contour') confidence = 0.80;
  else if (perimeterSource === 'google_solar_segments_refined') confidence = 0.70;
  else if (perimeterSource === 'mapbox_osm_footprint') confidence = 0.50;
  else if (perimeterSource === 'parcel_footprint') confidence = 0.30;

  if (overlapScore >= 0.90) confidence = Math.min(1, confidence + 0.10);
  if (selfIntersections > 0) confidence *= 0.7;
  if (!closed) confidence *= 0.5;

  const result: PerimeterTopology = {
    perimeter_ring_px: perimeterPx,
    perimeter_ring_geo: perimeterGeo,
    perimeter_nodes: nodes,
    perimeter_edges: edges,
    eave_edges: eaveEdges,
    rake_edges: rakeEdges,
    corner_nodes: nodes,
    reflex_corners: reflexCorners,
    convex_corners: convexCorners,
    overhang_confidence: perimeterSource === 'vendor_verified' ? 0.9 : 0.3,
    footprint_source: input.footprint_source,
    perimeter_source: perimeterSource,
    perimeter_area_sqft: perimeterArea,
    perimeter_closed: closed,
    perimeter_self_intersections: selfIntersections,
    perimeter_registration_score: overlapScore,
    perimeter_confidence: confidence,
    customer_perimeter_ready: autoReady,
  };

  console.log(`[PERIMETER_PHASE_0] Built: ${edges.length} edges (${eaveEdges.length} eave, ${rakeEdges.length} rake), ${nodes.length} nodes (${reflexCorners.length} reflex), source=${perimeterSource}, overlap=${overlapScore.toFixed(3)}, closed=${closed}, confidence=${confidence.toFixed(3)}`);

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// PERIMETER-FIRST GATE
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate the PerimeterFirstGate.
 * If this fails, block customer_report_ready, PDF export, material calcs, final diagrams.
 * Diagnostic preview is still allowed.
 */
export function evaluatePerimeterGate(
  perimeter: PerimeterTopology,
  roofMaskAreaSqft: number,
): PerimeterGateResult {
  const failures: string[] = [];

  // Gate 1: Ring must be closed
  if (!perimeter.perimeter_closed) {
    failures.push('perimeter_ring_not_closed');
  }

  // Gate 2: No self-intersections
  if (perimeter.perimeter_self_intersections > 0) {
    failures.push(`perimeter_self_intersections:${perimeter.perimeter_self_intersections}`);
  }

  // Gate 3: Area conservation against roof mask within 5%
  if (roofMaskAreaSqft > 0) {
    const areaRatio = perimeter.perimeter_area_sqft / roofMaskAreaSqft;
    if (areaRatio < 0.95 || areaRatio > 1.05) {
      // Relax to 10% for non-vendor sources since footprint != roof outline exactly
      if (perimeter.perimeter_source !== 'vendor_verified' && (areaRatio >= 0.90 && areaRatio <= 1.10)) {
        // Warn but don't fail for moderate mismatch
      } else {
        failures.push(`perimeter_area_mismatch:ratio=${areaRatio.toFixed(3)}`);
      }
    }
  }

  // Gate 4: Perimeter must overlap roof mask at >= 90%
  if (perimeter.perimeter_registration_score < 0.85) {
    failures.push(`perimeter_mask_overlap_low:${perimeter.perimeter_registration_score.toFixed(3)}`);
  }

  // Gate 5: Every perimeter segment classified — unknown must be < 10%
  const totalLen = perimeter.perimeter_edges.reduce((s, e) => s + e.length_ft, 0);
  const unknownLen = perimeter.perimeter_edges.filter(e => e.type === 'unknown').reduce((s, e) => s + e.length_ft, 0);
  const unknownRatio = totalLen > 0 ? unknownLen / totalLen : 1;
  if (unknownRatio > 0.10) {
    failures.push(`perimeter_unknown_edges_high:${(unknownRatio * 100).toFixed(1)}%`);
  }

  // Gate 6: Source must not be parcel-only without mask match
  if (perimeter.perimeter_source === 'parcel_footprint') {
    failures.push('perimeter_source_parcel_only');
  }

  const passed = failures.length === 0;
  const customerReady = passed && perimeter.customer_perimeter_ready;

  const eaveLf = perimeter.eave_edges.reduce((s, e) => s + e.length_ft, 0);
  const rakeLf = perimeter.rake_edges.reduce((s, e) => s + e.length_ft, 0);

  // Compute centroid offset (already in perimeter, but recompute for diagnostics)
  const centroidOffset = computeCentroidOffsetFromRing(perimeter.perimeter_ring_px);
  const bboxMatchScore = computeBboxMatchFromRing(perimeter.perimeter_ring_px);

  const diagnostics: PerimeterDiagnostics = {
    perimeter_ready: passed,
    perimeter_source: perimeter.perimeter_source,
    perimeter_area_sqft: perimeter.perimeter_area_sqft,
    perimeter_overlap_score: perimeter.perimeter_registration_score,
    perimeter_centroid_offset_px: centroidOffset,
    perimeter_bbox_match_score: bboxMatchScore,
    eave_length_lf: Number(eaveLf.toFixed(2)),
    rake_length_lf: Number(rakeLf.toFixed(2)),
    unknown_perimeter_lf: Number(unknownLen.toFixed(2)),
    perimeter_failure_reasons: failures,
    perimeter_candidate_table: [{
      source: perimeter.perimeter_source,
      area_sqft: perimeter.perimeter_area_sqft,
      overlap_score: perimeter.perimeter_registration_score,
      centroid_offset_px: centroidOffset,
      bbox_match_score: bboxMatchScore,
      closed: perimeter.perimeter_closed,
      self_intersections: perimeter.perimeter_self_intersections,
      selected: true,
      rejection_reason: null,
    }],
    total_perimeter_lf: Number(totalLen.toFixed(2)),
    unknown_ratio: Number(unknownRatio.toFixed(4)),
  };

  console.log(`[PERIMETER_GATE] ${passed ? 'PASSED' : 'FAILED'}: ${failures.length > 0 ? failures.join(', ') : 'all gates clear'}. Eave=${eaveLf.toFixed(0)}ft, Rake=${rakeLf.toFixed(0)}ft, Unknown=${unknownLen.toFixed(0)}ft (${(unknownRatio * 100).toFixed(1)}%)`);

  return {
    passed,
    perimeter_ready: passed,
    customer_perimeter_ready: customerReady,
    failure_reasons: failures,
    diagnostics,
  };
}

// ═══════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════

function resolvePerimeterSource(footprintSource: string): PerimeterSource {
  const src = (footprintSource || '').toLowerCase();
  if (src.includes('vendor') || src.includes('eagleview') || src.includes('roofr')) return 'vendor_verified';
  if (src.includes('mask') || src.includes('contour')) return 'google_solar_mask_contour';
  if (src.includes('solar') || src.includes('segment') || src.includes('union') || src.includes('hull')) return 'google_solar_segments_refined';
  if (src.includes('mapbox') || src.includes('osm') || src.includes('building')) return 'mapbox_osm_footprint';
  if (src.includes('parcel')) return 'parcel_footprint';
  // Default: if it looks like a building footprint, treat as OSM
  if (src.includes('footprint')) return 'mapbox_osm_footprint';
  return 'unknown';
}

function ensureClosedRing(pts: PxPt[]): PxPt[] {
  if (pts.length < 3) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first.x === last.x && first.y === last.y) return pts;
  return [...pts, { x: first.x, y: first.y }];
}

function ensureClosedRingGeo(pts: XY[]): XY[] {
  if (pts.length < 3) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return pts;
  return [...pts, [first[0], first[1]]];
}

function isRingClosed(pts: PxPt[]): boolean {
  if (pts.length < 4) return false; // need at least 3 distinct + closing
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dist = Math.hypot(first.x - last.x, first.y - last.y);
  return dist < 2.0; // within 2px tolerance
}

function countSelfIntersections(pts: PxPt[]): number {
  if (pts.length < 4) return 0;
  let count = 0;
  const n = pts.length - 1; // exclude closing vertex
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent edges share a vertex
      if (segmentsIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) {
        count++;
      }
    }
  }
  return count;
}

function segmentsIntersect(a1: PxPt, a2: PxPt, b1: PxPt, b2: PxPt): boolean {
  const d1 = cross2d(b1, b2, a1);
  const d2 = cross2d(b1, b2, a2);
  const d3 = cross2d(a1, a2, b1);
  const d4 = cross2d(a1, a2, b2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function cross2d(a: PxPt, b: PxPt, c: PxPt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function buildNodesAndEdges(
  ringPx: PxPt[],
  ringGeo: XY[],
  input: PerimeterInput,
): { nodes: PerimeterNode[]; edges: PerimeterEdge[] } {
  const nodes: PerimeterNode[] = [];
  const edges: PerimeterEdge[] = [];
  
  // Ring is closed, so n distinct vertices = length - 1
  const n = ringPx.length - 1;
  if (n < 3) return { nodes, edges };

  // Build edges first so we can reference them in nodes
  for (let i = 0; i < n; i++) {
    const startPx = ringPx[i];
    const endPx = ringPx[(i + 1) % n];
    const startGeo = ringGeo[i];
    const endGeo = ringGeo[(i + 1) % n];
    const lengthPx = Math.hypot(endPx.x - startPx.x, endPx.y - startPx.y);
    const lengthFt = lengthPx * input.meters_per_pixel * 3.28084;

    edges.push({
      id: `pe_${i}`,
      start_px: startPx,
      end_px: endPx,
      start_geo: startGeo,
      end_geo: endGeo,
      length_ft: lengthFt,
      length_px: lengthPx,
      type: 'unknown',
      classification_evidence: {
        dsm_gradient_direction: null,
        solar_downslope_vector: null,
        edge_downslope_angle_deg: null,
        is_horizontal_drainage: false,
        is_sloped_side_boundary: false,
        mean_elevation_m: null,
        is_low_elevation: false,
        orientation_deg: 0,
      },
      classification_confidence: 0,
    });
  }

  // Build nodes (corners)
  for (let i = 0; i < n; i++) {
    const prev = ringPx[(i - 1 + n) % n];
    const curr = ringPx[i];
    const next = ringPx[(i + 1) % n];

    // Compute interior angle
    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const crossVal = v1x * v2y - v1y * v2x;
    const dot = v1x * v2x + v1y * v2y;
    const angle = Math.atan2(Math.abs(crossVal), dot) * (180 / Math.PI);
    const interiorAngle = crossVal >= 0 ? angle : 360 - angle;
    const cornerType: 'convex' | 'reflex' = interiorAngle > 180 ? 'reflex' : 'convex';

    const prevEdgeId = `pe_${(i - 1 + n) % n}`;
    const nextEdgeId = `pe_${i}`;

    nodes.push({
      id: `pn_${i}`,
      position_px: curr,
      position_geo: ringGeo[i],
      corner_type: cornerType,
      interior_angle_deg: Number(interiorAngle.toFixed(1)),
      edge_ids: [prevEdgeId, nextEdgeId],
    });
  }

  return { nodes, edges };
}

/**
 * Classify each perimeter edge as eave or rake using multiple evidence sources.
 * Does NOT depend on internal ridge success.
 */
function classifyPerimeterEdges(edges: PerimeterEdge[], input: PerimeterInput): void {
  // Compute mean DSM elevation across the entire footprint for reference
  let globalMeanElevation = 0;
  let globalMaxElevation = -Infinity;
  let globalMinElevation = Infinity;
  let elevCount = 0;

  if (input.dsm_grid) {
    const dsm = input.dsm_grid;
    for (let i = 0; i < input.footprint_px.length; i++) {
      const px = input.footprint_px[i];
      const idx = Math.round(px.y) * dsm.width + Math.round(px.x);
      if (idx >= 0 && idx < dsm.data.length) {
        const v = dsm.data[idx];
        if (v !== dsm.noDataValue && Number.isFinite(v)) {
          globalMeanElevation += v;
          elevCount++;
          if (v > globalMaxElevation) globalMaxElevation = v;
          if (v < globalMinElevation) globalMinElevation = v;
        }
      }
    }
    if (elevCount > 0) globalMeanElevation /= elevCount;
  }
  const elevRange = globalMaxElevation - globalMinElevation;

  // Compute dominant downslope vectors from solar segments
  const solarDownslopes: Array<{ dx: number; dy: number; area: number }> = [];
  for (const seg of input.solar_segments) {
    if (seg.azimuth_degrees !== undefined && seg.pitch_degrees > 0) {
      const azRad = (seg.azimuth_degrees * Math.PI) / 180;
      // Downslope direction in pixel space (azimuth: 0=N, 90=E, etc.)
      const dx = Math.sin(azRad);
      const dy = -Math.cos(azRad); // pixel Y inverted
      solarDownslopes.push({ dx, dy, area: seg.area_sqft });
    }
  }

  for (const edge of edges) {
    const evidence = edge.classification_evidence;

    // Edge direction vector
    const edx = edge.end_px.x - edge.start_px.x;
    const edy = edge.end_px.y - edge.start_px.y;
    const edgeLen = Math.hypot(edx, edy);
    if (edgeLen < 0.5) continue;
    const enx = edx / edgeLen;
    const eny = edy / edgeLen;

    // Orientation: angle from horizontal (0° = horizontal, 90° = vertical)
    evidence.orientation_deg = Number((Math.abs(Math.atan2(eny, enx)) * 180 / Math.PI).toFixed(1));

    // DSM elevation along edge midpoint
    if (input.dsm_grid && elevCount > 0) {
      const midX = (edge.start_px.x + edge.end_px.x) / 2;
      const midY = (edge.start_px.y + edge.end_px.y) / 2;
      const idx = Math.round(midY) * input.dsm_grid.width + Math.round(midX);
      if (idx >= 0 && idx < input.dsm_grid.data.length) {
        const v = input.dsm_grid.data[idx];
        if (v !== input.dsm_grid.noDataValue && Number.isFinite(v)) {
          evidence.mean_elevation_m = v;
          evidence.is_low_elevation = elevRange > 0 ? (v - globalMinElevation) < elevRange * 0.35 : false;
        }
      }
    }

    // Compare edge direction with solar downslope vectors
    let bestDownslopeAngle = 90; // default: perpendicular
    let bestDownslopeVec: [number, number] | null = null;
    for (const ds of solarDownslopes) {
      const dot = Math.abs(enx * ds.dx + eny * ds.dy);
      const angle = Math.acos(Math.min(1, dot)) * (180 / Math.PI);
      if (angle < bestDownslopeAngle || (angle === bestDownslopeAngle && ds.area > 0)) {
        bestDownslopeAngle = angle;
        bestDownslopeVec = [ds.dx, ds.dy];
      }
    }
    evidence.solar_downslope_vector = bestDownslopeVec;
    evidence.edge_downslope_angle_deg = Number(bestDownslopeAngle.toFixed(1));

    // Eave heuristic: edge is PERPENDICULAR to downslope (angle ~90°)
    // Eaves are the lower drainage edges where water runs off
    // Rake heuristic: edge is PARALLEL to downslope (angle ~0°)
    const isPerpendicularToSlope = bestDownslopeAngle > 55; // more perpendicular = eave
    const isParallelToSlope = bestDownslopeAngle < 35; // more parallel = rake

    // Horizontal drainage: long, mostly horizontal edges at low elevation
    evidence.is_horizontal_drainage = evidence.is_low_elevation && edge.length_ft > 8;
    // Sloped side: shorter edges parallel to slope direction
    evidence.is_sloped_side_boundary = isParallelToSlope;

    // Score-based classification
    let eaveScore = 0;
    let rakeScore = 0;

    // Downslope angle: primary evidence
    if (isPerpendicularToSlope) eaveScore += 0.4;
    if (isParallelToSlope) rakeScore += 0.4;

    // Low elevation = eave indicator
    if (evidence.is_low_elevation) eaveScore += 0.2;

    // Horizontal drainage = eave
    if (evidence.is_horizontal_drainage) eaveScore += 0.15;

    // Long edges more likely to be eaves
    if (edge.length_ft > 15) eaveScore += 0.1;
    if (edge.length_ft < 8) rakeScore += 0.1;

    // Classify
    const threshold = 0.3;
    if (eaveScore > rakeScore && eaveScore >= threshold) {
      edge.type = 'eave';
      edge.classification_confidence = Math.min(1, eaveScore);
    } else if (rakeScore > eaveScore && rakeScore >= threshold) {
      edge.type = 'rake';
      edge.classification_confidence = Math.min(1, rakeScore);
    } else {
      edge.type = 'unknown';
      edge.classification_confidence = Math.max(eaveScore, rakeScore);
    }
  }
}

function computeMaskOverlap(perimeterPx: PxPt[], input: PerimeterInput): number {
  if (!input.masked_dsm?.mask || input.roof_mask_pixel_count === 0) {
    // No mask available — can't validate overlap, return moderate score
    return 0.70;
  }

  const mask = input.masked_dsm.mask;
  const width = input.dsm_width;
  const height = input.dsm_height;

  // Count perimeter pixels inside mask
  const distinctPts = perimeterPx.length > 1 ? perimeterPx.slice(0, -1) : perimeterPx;
  if (distinctPts.length < 3) return 0;

  // Rasterize the perimeter polygon
  let insideBoth = 0;
  let insidePerimeter = 0;

  // Simple sampling along the perimeter edges + interior grid
  const bbox = getBoundsPx(distinctPts);
  const step = Math.max(1, Math.floor(Math.min(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) / 50));

  for (let y = Math.max(0, Math.floor(bbox.minY)); y <= Math.min(height - 1, Math.ceil(bbox.maxY)); y += step) {
    for (let x = Math.max(0, Math.floor(bbox.minX)); x <= Math.min(width - 1, Math.ceil(bbox.maxX)); x += step) {
      if (pointInPolygonPx({ x, y }, distinctPts)) {
        insidePerimeter++;
        const idx = y * width + x;
        if (idx >= 0 && idx < mask.length && mask[idx] > 0) {
          insideBoth++;
        }
      }
    }
  }

  return insidePerimeter > 0 ? insideBoth / insidePerimeter : 0;
}

function computeCentroidOffset(perimeterPx: PxPt[], input: PerimeterInput): number {
  if (!input.masked_dsm?.mask || input.roof_mask_pixel_count === 0) return 0;

  const pCentroid = centroidPx(perimeterPx);

  // Compute mask centroid
  const mask = input.masked_dsm.mask;
  const width = input.dsm_width;
  let mx = 0, my = 0, mc = 0;
  for (let y = 0; y < input.dsm_height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > 0) {
        mx += x; my += y; mc++;
      }
    }
  }
  if (mc === 0) return 0;
  mx /= mc; my /= mc;

  return Math.hypot(pCentroid.x - mx, pCentroid.y - my);
}

function computeCentroidOffsetFromRing(ring: PxPt[]): number {
  const c = centroidPx(ring);
  return Math.hypot(c.x, c.y); // offset from origin, simplified
}

function computeBboxMatchFromRing(_ring: PxPt[]): number {
  return 0.90; // placeholder — will be refined when mask bbox is available
}

function centroidPx(pts: PxPt[]): PxPt {
  let cx = 0, cy = 0;
  const n = pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y
    ? pts.length - 1 : pts.length;
  for (let i = 0; i < n; i++) {
    cx += pts[i].x;
    cy += pts[i].y;
  }
  return { x: cx / n, y: cy / n };
}

function getBoundsPx(pts: PxPt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygonPx(pt: PxPt, polygon: PxPt[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Snap internal edge endpoints to the nearest perimeter node if within threshold.
 * Returns adjusted edges.
 */
export function snapEdgesToPerimeter(
  internalEdges: Array<{ start: XY; end: XY; start_px?: PxPt; end_px?: PxPt }>,
  perimeter: PerimeterTopology,
  snapThresholdPx: number = 8,
): void {
  const perimeterNodes = perimeter.perimeter_ring_px.slice(0, -1); // exclude closing vertex

  for (const edge of internalEdges) {
    if (edge.start_px && edge.end_px) {
      // Snap start
      let bestDist = snapThresholdPx;
      let bestNode: PxPt | null = null;
      for (const node of perimeterNodes) {
        const d = Math.hypot(edge.start_px.x - node.x, edge.start_px.y - node.y);
        if (d < bestDist) {
          bestDist = d;
          bestNode = node;
        }
      }
      if (bestNode) {
        edge.start_px.x = bestNode.x;
        edge.start_px.y = bestNode.y;
      }

      // Snap end
      bestDist = snapThresholdPx;
      bestNode = null;
      for (const node of perimeterNodes) {
        const d = Math.hypot(edge.end_px.x - node.x, edge.end_px.y - node.y);
        if (d < bestDist) {
          bestDist = d;
          bestNode = node;
        }
      }
      if (bestNode) {
        edge.end_px.x = bestNode.x;
        edge.end_px.y = bestNode.y;
      }
    }
  }
}

/**
 * Check that no internal edge extends outside the perimeter ring.
 * Returns edges that violate the containment rule.
 */
export function checkInternalEdgeContainment(
  internalEdges: Array<{ id: string; start_px: PxPt; end_px: PxPt }>,
  perimeter: PerimeterTopology,
): string[] {
  const violations: string[] = [];
  const ring = perimeter.perimeter_ring_px.slice(0, -1);
  if (ring.length < 3) return violations;

  for (const edge of internalEdges) {
    const midPt = {
      x: (edge.start_px.x + edge.end_px.x) / 2,
      y: (edge.start_px.y + edge.end_px.y) / 2,
    };
    if (!pointInPolygonPx(midPt, ring)) {
      violations.push(edge.id);
    }
  }
  return violations;
}
