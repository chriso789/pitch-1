/**
 * Constraint Roof Solver — Reverse-geometry topology inference
 *
 * Instead of relying solely on DSM edge detection, this module uses
 * Google Solar segment data (pitch, azimuth, area, bounding boxes),
 * the validated perimeter, and construction priors to REVERSE-SOLVE
 * the most likely internal roof topology.
 *
 * Pipeline:
 *   1. Lock pitch from Solar segments (area-weighted)
 *   2. Generate multiple topology candidates from perimeter + Solar priors
 *   3. Score each candidate against all available constraints
 *   4. Optimize the best candidate via local search
 *   5. Classify edges from adjacent face normals
 *   6. Return the best topology if it beats the autonomous solver
 *
 * COORDINATE-SPACE CONTRACT: All geometry in DSM pixel space.
 */

type PxPt = { x: number; y: number };

// ═══════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════

export interface SolarTopologyPrior {
  dominant_pitch_deg: number;
  dominant_pitch_rise: number; // rise per 12
  pitch_band: [number, number]; // [min_rise, max_rise] per 12
  segments: SolarSegmentPrior[];
  segment_adjacency: [number, number][]; // pairs of adjacent segment indices
  inferred_ridges: InferredEdge[];
  inferred_valleys: InferredEdge[];
  expected_facet_count: number;
  total_pitched_area_sqft: number;
  whole_roof_area_sqft: number;
}

export interface SolarSegmentPrior {
  index: number;
  pitch_deg: number;
  azimuth_deg: number;
  area_sqft: number;
  center_px: PxPt | null;
  bbox_px: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export interface InferredEdge {
  from_segment: number;
  to_segment: number;
  type: 'ridge' | 'valley' | 'hip';
  midpoint_px: PxPt | null;
  confidence: number;
}

export interface ConstraintCandidate {
  id: string;
  type: string; // 'simple_hip' | 'hip_cross_gable' | 'hip_nested_assembly' | 'hip_valley_connector' | 'multi_hip_complex'
  vertices: PxPt[];
  edges: CandidateEdge[];
  faces: CandidateFace[];
  score: ConstraintScore;
  rejected: boolean;
  rejection_reason?: string;
}

export interface CandidateEdge {
  a: PxPt;
  b: PxPt;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  length_px: number;
  source: 'constraint_solver';
}

export interface CandidateFace {
  polygon_px: PxPt[];
  area_px: number;
  pitch_deg: number;
  azimuth_deg: number;
  matched_solar_segment: number | null; // index into SolarSegmentPrior[]
}

export interface ConstraintScore {
  total: number;
  area_error: number;
  pitch_error: number;
  segment_area_agreement: number;
  segment_azimuth_agreement: number;
  dsm_edge_support: number;
  perimeter_compatibility: number;
  construction_plausibility: number;
  facet_count_penalty: number;
  max_plane_area_ratio: number;
}

export interface ConstraintSolverResult {
  used: boolean;
  best_candidate: ConstraintCandidate | null;
  candidates_evaluated: number;
  autonomous_score: number;
  constraint_score: number;
  reason: string;
  diagnostics: ConstraintSolverDiagnostics;
}

export interface ConstraintSolverDiagnostics {
  pitch_locked: boolean;
  pitch_band: [number, number];
  pitch_source: string;
  candidates_generated: number;
  candidates_rejected: number;
  optimization_iterations: number;
  solar_segments_used: number;
  timing_ms: number;
  candidate_scores: Array<{ id: string; type: string; score: number; rejected: boolean }>;
}

export interface DSMEdgeEvidence {
  a: PxPt;
  b: PxPt;
  type: 'ridge' | 'valley' | 'hip';
  score: number;
}

// ═══════════════════════════════════════════════════
// GEOMETRY HELPERS
// ═══════════════════════════════════════════════════

function ptDist(a: PxPt, b: PxPt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonAreaPx(pts: PxPt[]): number {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function polygonCentroid(pts: PxPt[]): PxPt {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  return { x: cx / pts.length, y: cy / pts.length };
}

function lerp(a: PxPt, b: PxPt, t: number): PxPt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function midpoint(a: PxPt, b: PxPt): PxPt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function edgeAngle(a: PxPt, b: PxPt): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Pitch degrees to rise/12 */
function pitchDegToRise(deg: number): number {
  return Math.tan(deg * Math.PI / 180) * 12;
}

/** Rise/12 to pitch degrees */
function pitchRiseToDeg(rise: number): number {
  return Math.atan(rise / 12) * 180 / Math.PI;
}

/** Pitch factor (slope area / plan area) */
function pitchFactor(pitchDeg: number): number {
  return 1 / Math.cos(pitchDeg * Math.PI / 180);
}

/** Compute azimuth from a face polygon (downslope direction from centroid to lowest edge midpoint) */
function inferAzimuth(polygon: PxPt[], footprintPx: PxPt[]): number {
  const c = polygonCentroid(polygon);
  // Find the edge of the polygon that lies on the footprint perimeter (eave)
  // The azimuth points from the ridge toward the eave
  let bestEdgeMid: PxPt | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const m = midpoint(a, b);
    // Check if this edge is on the perimeter
    for (let j = 0; j < footprintPx.length; j++) {
      const fa = footprintPx[j];
      const fb = footprintPx[(j + 1) % footprintPx.length];
      const d = pointToSegmentDist(m, fa, fb);
      if (d < bestDist) {
        bestDist = d;
        bestEdgeMid = m;
      }
    }
  }
  if (!bestEdgeMid || bestDist > 10) {
    // Fallback: use centroid to nearest footprint point
    let nearest = footprintPx[0];
    let nd = Infinity;
    for (const fp of footprintPx) {
      const d = ptDist(c, fp);
      if (d < nd) { nd = d; nearest = fp; }
    }
    bestEdgeMid = nearest;
  }
  // Azimuth = angle from centroid to eave midpoint, converted to compass bearing
  const angle = Math.atan2(bestEdgeMid.y - c.y, bestEdgeMid.x - c.x);
  // Convert math angle to compass bearing (0=N, 90=E, 180=S, 270=W)
  let bearing = (90 - angle * 180 / Math.PI + 360) % 360;
  return bearing;
}

function pointToSegmentDist(p: PxPt, a: PxPt, b: PxPt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return ptDist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return ptDist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Check if adjacent segments have opposing azimuths (ridge between them) */
function areOpposingAzimuths(az1: number, az2: number): boolean {
  const diff = Math.abs(az1 - az2);
  const normDiff = Math.min(diff, 360 - diff);
  return normDiff > 120 && normDiff < 240;
}

/** Check if adjacent segments have converging azimuths (valley between them) */
function areConvergingAzimuths(az1: number, az2: number): boolean {
  const diff = Math.abs(az1 - az2);
  const normDiff = Math.min(diff, 360 - diff);
  return normDiff > 60 && normDiff < 120;
}

// ═══════════════════════════════════════════════════
// PITCH LOCKING
// ═══════════════════════════════════════════════════

/**
 * Lock pitch from Solar segment data.
 * Returns area-weighted dominant pitch and a band of acceptable pitches.
 */
export function lockPitchFromSolar(
  segments: Array<{ pitchDegrees: number; azimuthDegrees: number; stats?: { areaMeters2: number }; areaMeters2?: number }>
): { pitch_deg: number; pitch_rise: number; band: [number, number] } | null {
  if (!segments || segments.length === 0) return null;

  let totalWeight = 0;
  let weightedPitch = 0;
  for (const seg of segments) {
    const area = seg.stats?.areaMeters2 || seg.areaMeters2 || 1;
    const pitch = seg.pitchDegrees ?? 0;
    if (pitch < 1) continue; // Skip flat segments
    weightedPitch += pitch * area;
    totalWeight += area;
  }
  if (totalWeight === 0) return null;

  const dominantPitchDeg = weightedPitch / totalWeight;
  const dominantRise = pitchDegToRise(dominantPitchDeg);
  // Band: ±1/12 around dominant
  const bandMin = Math.max(0.5, dominantRise - 1);
  const bandMax = dominantRise + 1;

  return {
    pitch_deg: dominantPitchDeg,
    pitch_rise: Math.round(dominantRise * 10) / 10,
    band: [Math.round(bandMin * 10) / 10, Math.round(bandMax * 10) / 10],
  };
}

// ═══════════════════════════════════════════════════
// TOPOLOGY CANDIDATE GENERATOR
// ═══════════════════════════════════════════════════

/**
 * Generate multiple candidate roof topologies from the perimeter and Solar priors.
 */
function generateCandidates(
  footprintPx: PxPt[],
  priors: SolarTopologyPrior,
  dsmEdges: DSMEdgeEvidence[],
): ConstraintCandidate[] {
  const candidates: ConstraintCandidate[] = [];
  const fpArea = polygonAreaPx(footprintPx);
  const fpBbox = bboxOfPoly(footprintPx);
  const fpCentroid = polygonCentroid(footprintPx);

  // Determine dominant axis (longer side of bounding box)
  const isWide = fpBbox.width >= fpBbox.height;

  // 1. Simple hip (4 facets)
  candidates.push(generateSimpleHip(footprintPx, fpBbox, fpCentroid, isWide, priors, 'simple_hip'));

  // 2. Hip + cross gable (8-10 facets) — assumes an L or T shaped footprint
  if (priors.segments.length >= 4) {
    const crossGable = generateHipCrossGable(footprintPx, fpBbox, fpCentroid, isWide, priors);
    if (crossGable) candidates.push(crossGable);
  }

  // 3. Hip + nested upper assembly (10-14 facets)
  if (priors.segments.length >= 6) {
    const nested = generateHipNestedAssembly(footprintPx, fpBbox, fpCentroid, isWide, priors);
    if (nested) candidates.push(nested);
  }

  // 4. Solar-segment-driven topology
  if (priors.segments.length >= 3) {
    const solarDriven = generateSolarDrivenTopology(footprintPx, fpBbox, fpCentroid, priors);
    if (solarDriven) candidates.push(solarDriven);
  }

  // 5. Multi-hip complex (12-16 facets)
  if (priors.segments.length >= 8) {
    const multiHip = generateMultiHipComplex(footprintPx, fpBbox, fpCentroid, isWide, priors);
    if (multiHip) candidates.push(multiHip);
  }

  return candidates;
}

function bboxOfPoly(pts: PxPt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Simple hip roof: 4 trapezoidal/triangular faces around a central ridge.
 */
function generateSimpleHip(
  footprintPx: PxPt[],
  bbox: ReturnType<typeof bboxOfPoly>,
  centroid: PxPt,
  isWide: boolean,
  priors: SolarTopologyPrior,
  id: string,
): ConstraintCandidate {
  // Ridge runs along the dominant axis, offset from edges
  const ridgeInset = isWide ? bbox.width * 0.2 : bbox.height * 0.2;
  let ridgeA: PxPt, ridgeB: PxPt;
  if (isWide) {
    ridgeA = { x: bbox.minX + ridgeInset, y: centroid.y };
    ridgeB = { x: bbox.maxX - ridgeInset, y: centroid.y };
  } else {
    ridgeA = { x: centroid.x, y: bbox.minY + ridgeInset };
    ridgeB = { x: centroid.x, y: bbox.maxY - ridgeInset };
  }

  // Create 4 faces using footprint corners and ridge endpoints
  const corners = getFootprintCorners(footprintPx, bbox);
  const faces = buildHipFaces(corners, ridgeA, ridgeB, isWide, priors, footprintPx);
  const edges = buildEdgesFromFaces(faces, footprintPx);

  return {
    id,
    type: 'simple_hip',
    vertices: [ridgeA, ridgeB, ...corners],
    edges,
    faces,
    score: emptyScore(),
    rejected: false,
  };
}

/**
 * Hip + cross gable: Main hip with a perpendicular gable wing.
 * Models L-shaped or T-shaped roofs.
 */
function generateHipCrossGable(
  footprintPx: PxPt[],
  bbox: ReturnType<typeof bboxOfPoly>,
  centroid: PxPt,
  isWide: boolean,
  priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  // Split footprint roughly in half at the centroid along the short axis
  // Main body gets a hip roof, extension gets another hip
  const splitRatio = 0.6;
  const mainBbox = { ...bbox };
  const extBbox = { ...bbox };

  if (isWide) {
    const splitX = bbox.minX + bbox.width * splitRatio;
    mainBbox.maxX = splitX;
    mainBbox.width = splitX - mainBbox.minX;
    extBbox.minX = splitX;
    extBbox.width = extBbox.maxX - splitX;
    // Offset extension vertically to simulate cross gable
    extBbox.minY = bbox.minY + bbox.height * 0.15;
    extBbox.maxY = bbox.maxY - bbox.height * 0.15;
    extBbox.height = extBbox.maxY - extBbox.minY;
  } else {
    const splitY = bbox.minY + bbox.height * splitRatio;
    mainBbox.maxY = splitY;
    mainBbox.height = splitY - mainBbox.minY;
    extBbox.minY = splitY;
    extBbox.height = extBbox.maxY - splitY;
    extBbox.minX = bbox.minX + bbox.width * 0.15;
    extBbox.maxX = bbox.maxX - bbox.width * 0.15;
    extBbox.width = extBbox.maxX - extBbox.minX;
  }

  const mainCentroid = { x: (mainBbox.minX + mainBbox.maxX) / 2, y: (mainBbox.minY + mainBbox.maxY) / 2 };
  const extCentroid = { x: (extBbox.minX + extBbox.maxX) / 2, y: (extBbox.minY + extBbox.maxY) / 2 };

  // Generate hip for each sub-region
  const mainCorners = cornersFromBbox(mainBbox);
  const extCorners = cornersFromBbox(extBbox);

  const mainRidgeInset = (isWide ? mainBbox.width : mainBbox.height) * 0.2;
  const extRidgeInset = (isWide ? extBbox.height : extBbox.width) * 0.2; // perpendicular

  let mainRidgeA: PxPt, mainRidgeB: PxPt, extRidgeA: PxPt, extRidgeB: PxPt;
  if (isWide) {
    mainRidgeA = { x: mainBbox.minX + mainRidgeInset, y: mainCentroid.y };
    mainRidgeB = { x: mainBbox.maxX - mainRidgeInset, y: mainCentroid.y };
    // Extension ridge runs perpendicular
    extRidgeA = { x: extCentroid.x, y: extBbox.minY + extRidgeInset };
    extRidgeB = { x: extCentroid.x, y: extBbox.maxY - extRidgeInset };
  } else {
    mainRidgeA = { x: mainCentroid.x, y: mainBbox.minY + mainRidgeInset };
    mainRidgeB = { x: mainCentroid.x, y: mainBbox.maxY - mainRidgeInset };
    extRidgeA = { x: extBbox.minX + extRidgeInset, y: extCentroid.y };
    extRidgeB = { x: extBbox.maxX - extRidgeInset, y: extCentroid.y };
  }

  const mainFaces = buildHipFaces(mainCorners, mainRidgeA, mainRidgeB, isWide, priors, footprintPx);
  const extFaces = buildHipFaces(extCorners, extRidgeA, extRidgeB, !isWide, priors, footprintPx);

  // Add valley faces at the junction
  const junctionFaces = buildValleyJunctionFaces(
    isWide ? mainRidgeB : mainRidgeB,
    isWide ? extRidgeA : extRidgeA,
    mainCorners, extCorners, isWide, priors, footprintPx
  );

  const allFaces = [...mainFaces, ...extFaces, ...junctionFaces];
  const edges = buildEdgesFromFaces(allFaces, footprintPx);

  return {
    id: 'hip_cross_gable',
    type: 'hip_cross_gable',
    vertices: [mainRidgeA, mainRidgeB, extRidgeA, extRidgeB, ...mainCorners, ...extCorners],
    edges,
    faces: allFaces,
    score: emptyScore(),
    rejected: false,
  };
}

/**
 * Hip + nested upper assembly (10-14 facets).
 * Main hip with a smaller upper hip assembly on top.
 */
function generateHipNestedAssembly(
  footprintPx: PxPt[],
  bbox: ReturnType<typeof bboxOfPoly>,
  centroid: PxPt,
  isWide: boolean,
  priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  // Main body hip
  const mainCorners = cornersFromBbox(bbox);
  const mainRidgeInset = (isWide ? bbox.width : bbox.height) * 0.2;
  let mainRA: PxPt, mainRB: PxPt;
  if (isWide) {
    mainRA = { x: bbox.minX + mainRidgeInset, y: centroid.y };
    mainRB = { x: bbox.maxX - mainRidgeInset, y: centroid.y };
  } else {
    mainRA = { x: centroid.x, y: bbox.minY + mainRidgeInset };
    mainRB = { x: centroid.x, y: bbox.maxY - mainRidgeInset };
  }

  const mainFaces = buildHipFaces(mainCorners, mainRA, mainRB, isWide, priors, footprintPx);

  // Upper assembly: smaller rectangle centered on the main ridge
  const upperScale = 0.4;
  const upperBbox = {
    minX: centroid.x - bbox.width * upperScale / 2,
    maxX: centroid.x + bbox.width * upperScale / 2,
    minY: centroid.y - bbox.height * upperScale / 2,
    maxY: centroid.y + bbox.height * upperScale / 2,
    width: bbox.width * upperScale,
    height: bbox.height * upperScale,
  };
  const upperCorners = cornersFromBbox(upperBbox);
  const upperRidgeInset = (isWide ? upperBbox.width : upperBbox.height) * 0.25;
  const upperCentroid = { x: (upperBbox.minX + upperBbox.maxX) / 2, y: (upperBbox.minY + upperBbox.maxY) / 2 };
  let upperRA: PxPt, upperRB: PxPt;
  if (isWide) {
    upperRA = { x: upperBbox.minX + upperRidgeInset, y: upperCentroid.y };
    upperRB = { x: upperBbox.maxX - upperRidgeInset, y: upperCentroid.y };
  } else {
    upperRA = { x: upperCentroid.x, y: upperBbox.minY + upperRidgeInset };
    upperRB = { x: upperCentroid.x, y: upperBbox.maxY - upperRidgeInset };
  }

  const upperFaces = buildHipFaces(upperCorners, upperRA, upperRB, isWide, priors, footprintPx);

  // Valley faces connecting upper to lower
  const valleyFaces: CandidateFace[] = [];
  for (let i = 0; i < upperCorners.length; i++) {
    const uc = upperCorners[i];
    // Find nearest main face corner
    let nearest = mainCorners[0];
    let nd = Infinity;
    for (const mc of mainCorners) {
      const d = ptDist(uc, mc);
      if (d < nd) { nd = d; nearest = mc; }
    }
    const tri: PxPt[] = [uc, nearest, upperCorners[(i + 1) % upperCorners.length]];
    valleyFaces.push({
      polygon_px: tri,
      area_px: polygonAreaPx(tri),
      pitch_deg: priors.dominant_pitch_deg,
      azimuth_deg: inferAzimuth(tri, footprintPx),
      matched_solar_segment: null,
    });
  }

  const allFaces = [...mainFaces, ...upperFaces, ...valleyFaces];
  const edges = buildEdgesFromFaces(allFaces, footprintPx);

  return {
    id: 'hip_nested_assembly',
    type: 'hip_nested_assembly',
    vertices: [mainRA, mainRB, upperRA, upperRB, ...mainCorners, ...upperCorners],
    edges,
    faces: allFaces,
    score: emptyScore(),
    rejected: false,
  };
}

/**
 * Solar-segment-driven topology.
 * Uses Solar segment centers and azimuth directions to partition the footprint.
 */
function generateSolarDrivenTopology(
  footprintPx: PxPt[],
  bbox: ReturnType<typeof bboxOfPoly>,
  centroid: PxPt,
  priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  const segmentsWithCenters = priors.segments.filter(s => s.center_px != null);
  if (segmentsWithCenters.length < 2) return null;

  // Use Voronoi-like partitioning: assign each footprint sample point to its nearest segment center
  // Then build face polygons from the partition boundaries
  const faces: CandidateFace[] = [];
  const fpArea = polygonAreaPx(footprintPx);

  // Simple approach: use Solar segment bounding boxes clipped to footprint
  for (const seg of priors.segments) {
    if (!seg.bbox_px) continue;
    const clipped = clipPolygonToRect(footprintPx, seg.bbox_px);
    if (clipped.length < 3) continue;
    const area = polygonAreaPx(clipped);
    if (area < fpArea * 0.02) continue; // Skip tiny fragments

    faces.push({
      polygon_px: clipped,
      area_px: area,
      pitch_deg: seg.pitch_deg,
      azimuth_deg: seg.azimuth_deg,
      matched_solar_segment: seg.index,
    });
  }

  if (faces.length < 3) return null;

  // Infer edges between adjacent faces
  const edges = buildEdgesFromFaces(faces, footprintPx);

  // Classify edges based on adjacent face azimuths
  for (const edge of edges) {
    if (edge.type !== 'eave' && edge.type !== 'rake') {
      // Find the two faces adjacent to this edge
      const adjFaces = findAdjacentFaces(edge, faces);
      if (adjFaces.length === 2) {
        const az1 = adjFaces[0].azimuth_deg;
        const az2 = adjFaces[1].azimuth_deg;
        if (areOpposingAzimuths(az1, az2)) {
          edge.type = 'ridge';
        } else if (areConvergingAzimuths(az1, az2)) {
          edge.type = 'valley';
        } else {
          edge.type = 'hip';
        }
      }
    }
  }

  return {
    id: 'solar_driven',
    type: 'solar_driven',
    vertices: faces.flatMap(f => f.polygon_px),
    edges,
    faces,
    score: emptyScore(),
    rejected: false,
  };
}

/**
 * Multi-hip complex (12-16 facets).
 * Multiple hip assemblies connected by valleys.
 */
function generateMultiHipComplex(
  footprintPx: PxPt[],
  bbox: ReturnType<typeof bboxOfPoly>,
  centroid: PxPt,
  isWide: boolean,
  priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  // Divide into 3 sections along the dominant axis
  const sections = 3;
  const allFaces: CandidateFace[] = [];
  const allVertices: PxPt[] = [];

  for (let s = 0; s < sections; s++) {
    const t0 = s / sections;
    const t1 = (s + 1) / sections;
    const secBbox = { ...bbox };
    if (isWide) {
      secBbox.minX = bbox.minX + bbox.width * t0;
      secBbox.maxX = bbox.minX + bbox.width * t1;
      secBbox.width = secBbox.maxX - secBbox.minX;
    } else {
      secBbox.minY = bbox.minY + bbox.height * t0;
      secBbox.maxY = bbox.minY + bbox.height * t1;
      secBbox.height = secBbox.maxY - secBbox.minY;
    }
    const secCorners = cornersFromBbox(secBbox);
    const secCentroid = { x: (secBbox.minX + secBbox.maxX) / 2, y: (secBbox.minY + secBbox.maxY) / 2 };
    const inset = (isWide ? secBbox.width : secBbox.height) * 0.2;
    let rA: PxPt, rB: PxPt;
    if (isWide) {
      rA = { x: secBbox.minX + inset, y: secCentroid.y };
      rB = { x: secBbox.maxX - inset, y: secCentroid.y };
    } else {
      rA = { x: secCentroid.x, y: secBbox.minY + inset };
      rB = { x: secCentroid.x, y: secBbox.maxY - inset };
    }
    const secFaces = buildHipFaces(secCorners, rA, rB, isWide, priors, footprintPx);
    allFaces.push(...secFaces);
    allVertices.push(rA, rB, ...secCorners);
  }

  const edges = buildEdgesFromFaces(allFaces, footprintPx);

  return {
    id: 'multi_hip_complex',
    type: 'multi_hip_complex',
    vertices: allVertices,
    edges,
    faces: allFaces,
    score: emptyScore(),
    rejected: false,
  };
}

// ═══════════════════════════════════════════════════
// FACE / EDGE BUILDING HELPERS
// ═══════════════════════════════════════════════════

function cornersFromBbox(bbox: { minX: number; minY: number; maxX: number; maxY: number }): PxPt[] {
  return [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.maxY },
  ];
}

function getFootprintCorners(footprintPx: PxPt[], bbox: ReturnType<typeof bboxOfPoly>): PxPt[] {
  // Use actual footprint vertices near corners
  const targets = cornersFromBbox(bbox);
  const corners: PxPt[] = [];
  for (const t of targets) {
    let nearest = footprintPx[0];
    let nd = Infinity;
    for (const fp of footprintPx) {
      const d = ptDist(fp, t);
      if (d < nd) { nd = d; nearest = fp; }
    }
    corners.push(nearest);
  }
  return corners;
}

function buildHipFaces(
  corners: PxPt[],
  ridgeA: PxPt,
  ridgeB: PxPt,
  isWide: boolean,
  priors: SolarTopologyPrior,
  footprintPx: PxPt[],
): CandidateFace[] {
  // 4-face hip: front, back, left-end, right-end
  // corners: [TL, TR, BR, BL] for wide; same for tall but axes swapped
  const [tl, tr, br, bl] = corners;
  const faces: CandidateFace[] = [];

  if (isWide) {
    // Front (top): TL -> TR -> ridgeB -> ridgeA
    faces.push(makeFace([tl, tr, ridgeB, ridgeA], priors, footprintPx));
    // Back (bottom): BL -> ridgeA -> ridgeB -> BR
    faces.push(makeFace([bl, ridgeA, ridgeB, br], priors, footprintPx));
    // Left end: TL -> ridgeA -> BL
    faces.push(makeFace([tl, ridgeA, bl], priors, footprintPx));
    // Right end: TR -> BR -> ridgeB
    faces.push(makeFace([tr, br, ridgeB], priors, footprintPx));
  } else {
    // Left: TL -> ridgeA -> ridgeB -> BL
    faces.push(makeFace([tl, ridgeA, ridgeB, bl], priors, footprintPx));
    // Right: TR -> BR -> ridgeB -> ridgeA
    faces.push(makeFace([tr, br, ridgeB, ridgeA], priors, footprintPx));
    // Top end: TL -> TR -> ridgeA
    faces.push(makeFace([tl, tr, ridgeA], priors, footprintPx));
    // Bottom end: BL -> ridgeB -> BR
    faces.push(makeFace([bl, ridgeB, br], priors, footprintPx));
  }

  return faces;
}

function buildValleyJunctionFaces(
  mainRidgeEnd: PxPt,
  extRidgeStart: PxPt,
  mainCorners: PxPt[],
  extCorners: PxPt[],
  isWide: boolean,
  priors: SolarTopologyPrior,
  footprintPx: PxPt[],
): CandidateFace[] {
  // Create 2 triangular valley faces at the junction
  const faces: CandidateFace[] = [];
  const junctionMid = midpoint(mainRidgeEnd, extRidgeStart);

  // Find nearby corners from both sets
  const allCorners = [...mainCorners, ...extCorners];
  const sorted = allCorners
    .map(c => ({ pt: c, dist: ptDist(c, junctionMid) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 4);

  if (sorted.length >= 2) {
    faces.push(makeFace([mainRidgeEnd, extRidgeStart, sorted[0].pt], priors, footprintPx));
    if (sorted.length >= 3) {
      faces.push(makeFace([mainRidgeEnd, extRidgeStart, sorted[1].pt], priors, footprintPx));
    }
  }

  return faces;
}

function makeFace(polygon: PxPt[], priors: SolarTopologyPrior, footprintPx: PxPt[]): CandidateFace {
  const area = polygonAreaPx(polygon);
  const azimuth = inferAzimuth(polygon, footprintPx);
  return {
    polygon_px: polygon,
    area_px: area,
    pitch_deg: priors.dominant_pitch_deg,
    azimuth_deg: azimuth,
    matched_solar_segment: null,
  };
}

function buildEdgesFromFaces(faces: CandidateFace[], footprintPx: PxPt[]): CandidateEdge[] {
  const edgeMap = new Map<string, CandidateEdge>();

  for (const face of faces) {
    const poly = face.polygon_px;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const key = edgeKey(a, b);
      if (!edgeMap.has(key)) {
        const isPerimeter = isEdgeOnPerimeter(a, b, footprintPx);
        edgeMap.set(key, {
          a, b,
          type: isPerimeter ? 'eave' : 'hip', // Default interior to hip
          length_px: ptDist(a, b),
          source: 'constraint_solver',
        });
      }
    }
  }

  return Array.from(edgeMap.values());
}

function edgeKey(a: PxPt, b: PxPt): string {
  const ka = `${Math.round(a.x)},${Math.round(a.y)}`;
  const kb = `${Math.round(b.x)},${Math.round(b.y)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function isEdgeOnPerimeter(a: PxPt, b: PxPt, footprintPx: PxPt[]): boolean {
  const m = midpoint(a, b);
  for (let i = 0; i < footprintPx.length; i++) {
    const fa = footprintPx[i];
    const fb = footprintPx[(i + 1) % footprintPx.length];
    if (pointToSegmentDist(m, fa, fb) < 5 &&
        pointToSegmentDist(a, fa, fb) < 8 &&
        pointToSegmentDist(b, fa, fb) < 8) {
      return true;
    }
  }
  return false;
}

function findAdjacentFaces(edge: CandidateEdge, faces: CandidateFace[]): CandidateFace[] {
  const result: CandidateFace[] = [];
  const em = midpoint(edge.a, edge.b);
  for (const face of faces) {
    for (let i = 0; i < face.polygon_px.length; i++) {
      const a = face.polygon_px[i];
      const b = face.polygon_px[(i + 1) % face.polygon_px.length];
      const fm = midpoint(a, b);
      if (ptDist(em, fm) < 8) {
        result.push(face);
        break;
      }
    }
    if (result.length >= 2) break;
  }
  return result;
}

/** Sutherland-Hodgman clip */
function clipPolygonToRect(poly: PxPt[], rect: { minX: number; minY: number; maxX: number; maxY: number }): PxPt[] {
  if (!poly || poly.length < 3) return [];
  const edges: Array<(p: PxPt) => boolean> = [
    p => p.x >= rect.minX,
    p => p.x <= rect.maxX,
    p => p.y >= rect.minY,
    p => p.y <= rect.maxY,
  ];
  const intersect = (a: PxPt, b: PxPt, side: number): PxPt => {
    if (side === 0) { const t = (rect.minX - a.x) / (b.x - a.x); return { x: rect.minX, y: a.y + t * (b.y - a.y) }; }
    if (side === 1) { const t = (rect.maxX - a.x) / (b.x - a.x); return { x: rect.maxX, y: a.y + t * (b.y - a.y) }; }
    if (side === 2) { const t = (rect.minY - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: rect.minY }; }
    const t = (rect.maxY - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: rect.maxY };
  };
  let out = poly.slice();
  for (let s = 0; s < 4; s++) {
    const inside = edges[s];
    const input = out;
    out = [];
    if (input.length === 0) break;
    let prev = input[input.length - 1];
    for (const cur of input) {
      const curIn = inside(cur), prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur, s));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur, s));
      }
      prev = cur;
    }
  }
  return out;
}

function emptyScore(): ConstraintScore {
  return {
    total: 0, area_error: 0, pitch_error: 0, segment_area_agreement: 0,
    segment_azimuth_agreement: 0, dsm_edge_support: 0, perimeter_compatibility: 0,
    construction_plausibility: 0, facet_count_penalty: 0, max_plane_area_ratio: 0,
  };
}

// ═══════════════════════════════════════════════════
// CONSTRAINT SCORING
// ═══════════════════════════════════════════════════

const WEIGHTS = {
  area_error: 0.20,
  pitch_error: 0.15,
  segment_area_agreement: 0.15,
  segment_azimuth_agreement: 0.10,
  dsm_edge_support: 0.10,
  perimeter_compatibility: 0.10,
  construction_plausibility: 0.10,
  facet_count_penalty: 0.05,
  max_plane_area_ratio: 0.05,
};

function scoreCandidate(
  candidate: ConstraintCandidate,
  priors: SolarTopologyPrior,
  footprintPx: PxPt[],
  dsmEdges: DSMEdgeEvidence[],
  pxToSqft: number,
): ConstraintScore {
  const fpArea = polygonAreaPx(footprintPx);
  const totalCandArea = candidate.faces.reduce((s, f) => s + f.area_px, 0);

  // 1. Area error: candidate total vs Solar wholeRoofStats target
  const candidateAreaSqft = totalCandArea * pxToSqft * pitchFactor(priors.dominant_pitch_deg);
  const areaTarget = priors.whole_roof_area_sqft || priors.total_pitched_area_sqft;
  const areaErrorPct = areaTarget > 0 ? Math.abs(candidateAreaSqft - areaTarget) / areaTarget : 0.5;
  const areaScore = Math.max(0, 1 - areaErrorPct * 5); // 20% error → 0

  // 2. Pitch error
  const candidatePitch = priors.dominant_pitch_deg;
  const pitchError = Math.abs(pitchDegToRise(candidatePitch) - priors.dominant_pitch_rise);
  const pitchScore = Math.max(0, 1 - pitchError / 3); // 3/12 error → 0

  // 3. Segment area agreement
  let segAreaScore = 0.5;
  if (priors.segments.length > 0) {
    let matchedArea = 0;
    let totalSegArea = 0;
    for (const seg of priors.segments) {
      totalSegArea += seg.area_sqft;
      // Find face best matching this segment
      let bestMatch = 0;
      for (const face of candidate.faces) {
        const faceAreaSqft = face.area_px * pxToSqft * pitchFactor(face.pitch_deg);
        const ratio = Math.min(faceAreaSqft, seg.area_sqft) / Math.max(faceAreaSqft, seg.area_sqft);
        if (ratio > bestMatch) bestMatch = ratio;
      }
      matchedArea += bestMatch * seg.area_sqft;
    }
    segAreaScore = totalSegArea > 0 ? matchedArea / totalSegArea : 0.5;
  }

  // 4. Segment azimuth agreement
  let segAzScore = 0.5;
  if (priors.segments.length > 0 && candidate.faces.length > 0) {
    let azMatchSum = 0;
    let azCount = 0;
    for (const seg of priors.segments) {
      for (const face of candidate.faces) {
        if (face.matched_solar_segment === seg.index) {
          const azDiff = Math.min(
            Math.abs(face.azimuth_deg - seg.azimuth_deg),
            360 - Math.abs(face.azimuth_deg - seg.azimuth_deg)
          );
          azMatchSum += Math.max(0, 1 - azDiff / 90);
          azCount++;
        }
      }
    }
    if (azCount > 0) segAzScore = azMatchSum / azCount;
  }

  // 5. DSM edge support
  let dsmScore = 0.3; // Default when no DSM edges
  if (dsmEdges.length > 0) {
    let supportedEdges = 0;
    for (const ce of candidate.edges) {
      if (ce.type === 'eave' || ce.type === 'rake') continue;
      const cem = midpoint(ce.a, ce.b);
      for (const de of dsmEdges) {
        const dem = midpoint(de.a, de.b);
        if (ptDist(cem, dem) < 20) {
          supportedEdges++;
          break;
        }
      }
    }
    const interiorEdges = candidate.edges.filter(e => e.type !== 'eave' && e.type !== 'rake').length;
    dsmScore = interiorEdges > 0 ? supportedEdges / interiorEdges : 0.3;
  }

  // 6. Perimeter compatibility
  const perimeterScore = totalCandArea > 0 ? Math.min(1, totalCandArea / fpArea) : 0;

  // 7. Construction plausibility
  let plausScore = 1.0;
  const ridgeEdges = candidate.edges.filter(e => e.type === 'ridge');
  const valleyEdges = candidate.edges.filter(e => e.type === 'valley');
  const hipEdges = candidate.edges.filter(e => e.type === 'hip');
  if (ridgeEdges.length === 0 && candidate.faces.length >= 4) plausScore -= 0.4;
  if (candidate.faces.length < 3 && priors.expected_facet_count > 6) plausScore -= 0.3;
  // Check for isolated faces (no shared edges)
  plausScore = Math.max(0, plausScore);

  // 8. Facet count penalty
  const facetDiff = Math.abs(candidate.faces.length - priors.expected_facet_count);
  const facetScore = Math.max(0, 1 - facetDiff / Math.max(priors.expected_facet_count, 4) * 2);

  // 9. Max plane area ratio
  const maxFaceArea = Math.max(...candidate.faces.map(f => f.area_px));
  const maxPlaneRatio = totalCandArea > 0 ? maxFaceArea / totalCandArea : 1;
  const planeRatioScore = Math.max(0, 1 - Math.max(0, maxPlaneRatio - 0.25) * 4);

  const score: ConstraintScore = {
    area_error: areaScore,
    pitch_error: pitchScore,
    segment_area_agreement: segAreaScore,
    segment_azimuth_agreement: segAzScore,
    dsm_edge_support: dsmScore,
    perimeter_compatibility: perimeterScore,
    construction_plausibility: plausScore,
    facet_count_penalty: facetScore,
    max_plane_area_ratio: planeRatioScore,
    total: 0,
  };

  // Compute weighted total
  score.total =
    score.area_error * WEIGHTS.area_error +
    score.pitch_error * WEIGHTS.pitch_error +
    score.segment_area_agreement * WEIGHTS.segment_area_agreement +
    score.segment_azimuth_agreement * WEIGHTS.segment_azimuth_agreement +
    score.dsm_edge_support * WEIGHTS.dsm_edge_support +
    score.perimeter_compatibility * WEIGHTS.perimeter_compatibility +
    score.construction_plausibility * WEIGHTS.construction_plausibility +
    score.facet_count_penalty * WEIGHTS.facet_count_penalty +
    score.max_plane_area_ratio * WEIGHTS.max_plane_area_ratio;

  return score;
}

// ═══════════════════════════════════════════════════
// LOCAL SEARCH OPTIMIZATION
// ═══════════════════════════════════════════════════

function optimizeCandidate(
  candidate: ConstraintCandidate,
  priors: SolarTopologyPrior,
  footprintPx: PxPt[],
  dsmEdges: DSMEdgeEvidence[],
  pxToSqft: number,
): { candidate: ConstraintCandidate; iterations: number } {
  let best = candidate;
  let bestScore = candidate.score.total;
  let iterations = 0;
  const maxIterations = 30;
  let plateau = 0;

  while (iterations < maxIterations && plateau < 5) {
    iterations++;
    let improved = false;

    // Try moving interior vertices
    for (let vi = 0; vi < best.vertices.length; vi++) {
      const v = best.vertices[vi];
      if (isEdgeOnPerimeter(v, v, footprintPx)) continue; // Skip perimeter vertices

      for (const delta of [
        { x: 3, y: 0 }, { x: -3, y: 0 }, { x: 0, y: 3 }, { x: 0, y: -3 },
        { x: 2, y: 2 }, { x: -2, y: 2 }, { x: 2, y: -2 }, { x: -2, y: -2 },
      ]) {
        const moved = { x: v.x + delta.x, y: v.y + delta.y };
        const newCandidate = cloneCandidateWithMovedVertex(best, vi, moved, priors, footprintPx);
        const newScore = scoreCandidate(newCandidate, priors, footprintPx, dsmEdges, pxToSqft);
        if (newScore.total > bestScore) {
          newCandidate.score = newScore;
          best = newCandidate;
          bestScore = newScore.total;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }

    if (!improved) {
      plateau++;
    } else {
      plateau = 0;
    }
  }

  return { candidate: best, iterations };
}

function cloneCandidateWithMovedVertex(
  original: ConstraintCandidate,
  vertexIndex: number,
  newPos: PxPt,
  priors: SolarTopologyPrior,
  footprintPx: PxPt[],
): ConstraintCandidate {
  const oldPos = original.vertices[vertexIndex];
  const vertices = original.vertices.map((v, i) => i === vertexIndex ? newPos : { ...v });

  // Update faces that reference this vertex
  const faces = original.faces.map(f => {
    const newPoly = f.polygon_px.map(p =>
      ptDist(p, oldPos) < 2 ? newPos : { ...p }
    );
    return {
      ...f,
      polygon_px: newPoly,
      area_px: polygonAreaPx(newPoly),
      azimuth_deg: inferAzimuth(newPoly, footprintPx),
    };
  });

  const edges = buildEdgesFromFaces(faces, footprintPx);

  return {
    ...original,
    vertices,
    faces,
    edges,
    score: emptyScore(),
  };
}

// ═══════════════════════════════════════════════════
// EDGE CLASSIFICATION FROM ADJACENT NORMALS
// ═══════════════════════════════════════════════════

function classifyEdgesFromNormals(candidate: ConstraintCandidate): void {
  for (const edge of candidate.edges) {
    if (edge.type === 'eave' || edge.type === 'rake') continue;

    const adjFaces = findAdjacentFaces(edge, candidate.faces);
    if (adjFaces.length < 2) {
      // Perimeter-adjacent interior edge
      if (adjFaces.length === 1) {
        edge.type = 'hip';
      }
      continue;
    }

    const az1 = adjFaces[0].azimuth_deg;
    const az2 = adjFaces[1].azimuth_deg;

    if (areOpposingAzimuths(az1, az2)) {
      edge.type = 'ridge';
    } else if (areConvergingAzimuths(az1, az2)) {
      edge.type = 'valley';
    } else {
      edge.type = 'hip';
    }
  }
}

// ═══════════════════════════════════════════════════
// AUTONOMOUS RESULT SCORING
// ═══════════════════════════════════════════════════

/**
 * Score the autonomous solver result using the same constraint framework.
 * This enables apples-to-apples comparison with constraint solver candidates.
 */
export function scoreAutonomousResult(
  faces: Array<{ polygon: [number, number][]; pitch_degrees: number; azimuth_degrees: number; plan_area_sqft: number; roof_area_sqft: number }>,
  edges: Array<{ type: string; length_ft: number }>,
  priors: SolarTopologyPrior,
  footprintAreaSqft: number,
): number {
  if (faces.length === 0) return 0;

  const totalArea = faces.reduce((s, f) => s + f.roof_area_sqft, 0);
  const areaTarget = priors.whole_roof_area_sqft || priors.total_pitched_area_sqft;

  // Area error
  const areaErrorPct = areaTarget > 0 ? Math.abs(totalArea - areaTarget) / areaTarget : 0.5;
  const areaScore = Math.max(0, 1 - areaErrorPct * 5);

  // Pitch error
  const avgPitch = faces.reduce((s, f) => s + f.pitch_degrees, 0) / faces.length;
  const pitchRise = pitchDegToRise(avgPitch);
  const pitchError = Math.abs(pitchRise - priors.dominant_pitch_rise);
  const pitchScore = Math.max(0, 1 - pitchError / 3);

  // Facet count
  const facetDiff = Math.abs(faces.length - priors.expected_facet_count);
  const facetScore = Math.max(0, 1 - facetDiff / Math.max(priors.expected_facet_count, 4) * 2);

  // Ridge presence
  const ridgeFt = edges.filter(e => e.type === 'ridge').reduce((s, e) => s + e.length_ft, 0);
  const ridgeScore = faces.length >= 4 && ridgeFt === 0 ? 0.2 : 1.0;

  // Max plane ratio
  const maxFaceArea = Math.max(...faces.map(f => f.roof_area_sqft));
  const maxPlaneRatio = totalArea > 0 ? maxFaceArea / totalArea : 1;
  const planeScore = Math.max(0, 1 - Math.max(0, maxPlaneRatio - 0.25) * 4);

  return (
    areaScore * 0.20 +
    pitchScore * 0.20 +
    facetScore * 0.20 +
    ridgeScore * 0.20 +
    planeScore * 0.20
  );
}

// ═══════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════

/**
 * Run the constraint roof solver.
 *
 * @param footprintPx Validated footprint polygon in DSM pixel space
 * @param priors Solar topology priors extracted from Google Solar API
 * @param dsmEdges DSM-detected edge evidence
 * @param pxToSqft Conversion factor from pixel² to sqft
 * @param autonomousScore Score of the autonomous solver result (0-1)
 * @returns ConstraintSolverResult
 */
export function solveConstraintRoof(
  footprintPx: PxPt[],
  priors: SolarTopologyPrior,
  dsmEdges: DSMEdgeEvidence[],
  pxToSqft: number,
  autonomousScore: number,
): ConstraintSolverResult {
  const t0 = Date.now();

  // Quick exit if no Solar priors
  if (!priors || priors.segments.length < 2) {
    return {
      used: false,
      best_candidate: null,
      candidates_evaluated: 0,
      autonomous_score: autonomousScore,
      constraint_score: 0,
      reason: 'insufficient_solar_priors',
      diagnostics: {
        pitch_locked: false,
        pitch_band: [0, 0],
        pitch_source: 'none',
        candidates_generated: 0,
        candidates_rejected: 0,
        optimization_iterations: 0,
        solar_segments_used: priors?.segments.length || 0,
        timing_ms: Date.now() - t0,
        candidate_scores: [],
      },
    };
  }

  // 1. Generate candidates
  const candidates = generateCandidates(footprintPx, priors, dsmEdges);
  console.log(`[CONSTRAINT_SOLVER] Generated ${candidates.length} candidates from ${priors.segments.length} solar segments`);

  // 2. Score each candidate
  for (const cand of candidates) {
    const score = scoreCandidate(cand, priors, footprintPx, dsmEdges, pxToSqft);
    cand.score = score;

    // Reject candidates outside pitch band
    if (priors.pitch_band) {
      const candPitchRise = pitchDegToRise(priors.dominant_pitch_deg);
      if (candPitchRise < priors.pitch_band[0] - 0.5 || candPitchRise > priors.pitch_band[1] + 0.5) {
        cand.rejected = true;
        cand.rejection_reason = 'pitch_outside_band';
      }
    }

    // Reject candidates with area error > 20%
    if (cand.score.area_error < 0.2) {
      cand.rejected = true;
      cand.rejection_reason = 'area_error_too_high';
    }
  }

  // 3. Sort by score descending
  const validCandidates = candidates.filter(c => !c.rejected);
  validCandidates.sort((a, b) => b.score.total - a.score.total);

  if (validCandidates.length === 0) {
    return {
      used: false,
      best_candidate: null,
      candidates_evaluated: candidates.length,
      autonomous_score: autonomousScore,
      constraint_score: 0,
      reason: 'all_candidates_rejected',
      diagnostics: {
        pitch_locked: true,
        pitch_band: priors.pitch_band,
        pitch_source: 'google_solar_roofSegmentStats',
        candidates_generated: candidates.length,
        candidates_rejected: candidates.filter(c => c.rejected).length,
        optimization_iterations: 0,
        solar_segments_used: priors.segments.length,
        timing_ms: Date.now() - t0,
        candidate_scores: candidates.map(c => ({
          id: c.id, type: c.type, score: Number(c.score.total.toFixed(3)), rejected: c.rejected,
        })),
      },
    };
  }

  // 4. Optimize the best candidate
  const best = validCandidates[0];
  const optimized = optimizeCandidate(best, priors, footprintPx, dsmEdges, pxToSqft);

  // 5. Classify edges from adjacent normals
  classifyEdgesFromNormals(optimized.candidate);

  // Re-score after optimization and classification
  optimized.candidate.score = scoreCandidate(optimized.candidate, priors, footprintPx, dsmEdges, pxToSqft);
  const constraintScore = optimized.candidate.score.total;

  console.log(`[CONSTRAINT_SOLVER] Best: ${optimized.candidate.type} score=${constraintScore.toFixed(3)} vs autonomous=${autonomousScore.toFixed(3)} (${optimized.iterations} optimization iterations)`);

  // 6. Decide: use constraint solver only if it significantly beats autonomous
  const IMPROVEMENT_THRESHOLD = 0.10; // Constraint must be at least 10% better
  const useConstraint = constraintScore > autonomousScore + IMPROVEMENT_THRESHOLD;

  return {
    used: useConstraint,
    best_candidate: optimized.candidate,
    candidates_evaluated: candidates.length,
    autonomous_score: autonomousScore,
    constraint_score: constraintScore,
    reason: useConstraint
      ? `constraint_solver_wins_${constraintScore.toFixed(3)}_vs_${autonomousScore.toFixed(3)}`
      : `autonomous_adequate_${autonomousScore.toFixed(3)}_vs_constraint_${constraintScore.toFixed(3)}`,
    diagnostics: {
      pitch_locked: true,
      pitch_band: priors.pitch_band,
      pitch_source: 'google_solar_roofSegmentStats',
      candidates_generated: candidates.length,
      candidates_rejected: candidates.filter(c => c.rejected).length,
      optimization_iterations: optimized.iterations,
      solar_segments_used: priors.segments.length,
      timing_ms: Date.now() - t0,
      candidate_scores: candidates
        .map(c => ({ id: c.id, type: c.type, score: Number(c.score.total.toFixed(3)), rejected: c.rejected }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
    },
  };
}
