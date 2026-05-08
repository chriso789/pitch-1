/**
 * Constraint Roof Solver v2 — Constrained Topology Optimization Engine
 *
 * Paradigm shift from v1:
 *   v1: detect → merge → validate
 *   v2: constrain → solve → optimize
 *
 * Uses Google Solar segments, DSM, perimeter, and construction priors to
 * REVERSE-SOLVE the most plausible roof topology via constraint satisfaction.
 *
 * The key insight: complex roofs like Fonsica (14 facets, 6/12 pitch) are
 * structurally hierarchical:
 *   - large lower hip body
 *   - central ridge/connector
 *   - upper local hip assemblies
 *   - mirrored valley systems
 *   - uniform pitch
 *
 * This means the roof is OVERCONSTRAINED — the solver doesn't need to
 * perfectly "see" every edge, it can mathematically solve what the roof
 * MUST be given the constraints.
 *
 * COORDINATE-SPACE CONTRACT: All geometry in DSM pixel space.
 */

type PxPt = { x: number; y: number };

// ═══════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════

export interface SolarTopologyPrior {
  dominant_pitch_deg: number;
  dominant_pitch_rise: number;
  pitch_band: [number, number];
  segments: SolarSegmentPrior[];
  segment_adjacency: [number, number][];
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
  type: string;
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
  matched_solar_segment: number | null;
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
  // v2 additions
  symmetry_score: number;
  ridge_valley_continuity: number;
  assembly_hierarchy: number;
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
  candidate_scores: Array<{ id: string; type: string; score: number; rejected: boolean; rejection_reason?: string }>;
  rejected_topologies: Array<{ id: string; type: string; reason: string }>;
  optimization_moves: string[];
  constraint_error_breakdown: Record<string, number>;
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

function pitchDegToRise(deg: number): number {
  return Math.tan(deg * Math.PI / 180) * 12;
}

function pitchRiseToDeg(rise: number): number {
  return Math.atan(rise / 12) * 180 / Math.PI;
}

function pitchFactor(pitchDeg: number): number {
  return 1 / Math.cos(pitchDeg * Math.PI / 180);
}

function pointToSegmentDist(p: PxPt, a: PxPt, b: PxPt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return ptDist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return ptDist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function inferAzimuth(polygon: PxPt[], footprintPx: PxPt[]): number {
  const c = polygonCentroid(polygon);
  let bestEdgeMid: PxPt | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const m = midpoint(a, b);
    for (let j = 0; j < footprintPx.length; j++) {
      const fa = footprintPx[j];
      const fb = footprintPx[(j + 1) % footprintPx.length];
      const d = pointToSegmentDist(m, fa, fb);
      if (d < bestDist) { bestDist = d; bestEdgeMid = m; }
    }
  }
  if (!bestEdgeMid || bestDist > 10) {
    let nearest = footprintPx[0];
    let nd = Infinity;
    for (const fp of footprintPx) {
      const d = ptDist(c, fp);
      if (d < nd) { nd = d; nearest = fp; }
    }
    bestEdgeMid = nearest;
  }
  const angle = Math.atan2(bestEdgeMid.y - c.y, bestEdgeMid.x - c.x);
  return (90 - angle * 180 / Math.PI + 360) % 360;
}

function areOpposingAzimuths(az1: number, az2: number): boolean {
  const diff = Math.abs(az1 - az2);
  const normDiff = Math.min(diff, 360 - diff);
  return normDiff > 120 && normDiff < 240;
}

function areConvergingAzimuths(az1: number, az2: number): boolean {
  const diff = Math.abs(az1 - az2);
  const normDiff = Math.min(diff, 360 - diff);
  return normDiff > 60 && normDiff < 120;
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

function cornersFromBbox(bbox: { minX: number; minY: number; maxX: number; maxY: number }): PxPt[] {
  return [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.maxY },
  ];
}

function getFootprintCorners(footprintPx: PxPt[], bbox: ReturnType<typeof bboxOfPoly>): PxPt[] {
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
      if (ptDist(em, fm) < 8) { result.push(face); break; }
    }
    if (result.length >= 2) break;
  }
  return result;
}

function clipPolygonToRect(poly: PxPt[], rect: { minX: number; minY: number; maxX: number; maxY: number }): PxPt[] {
  if (!poly || poly.length < 3) return [];
  const edges: Array<(p: PxPt) => boolean> = [
    p => p.x >= rect.minX, p => p.x <= rect.maxX,
    p => p.y >= rect.minY, p => p.y <= rect.maxY,
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
    symmetry_score: 0, ridge_valley_continuity: 0, assembly_hierarchy: 0,
  };
}

// ═══════════════════════════════════════════════════
// PITCH LOCKING
// ═══════════════════════════════════════════════════

export function lockPitchFromSolar(
  segments: Array<{ pitchDegrees: number; azimuthDegrees: number; stats?: { areaMeters2: number }; areaMeters2?: number }>
): { pitch_deg: number; pitch_rise: number; band: [number, number] } | null {
  if (!segments || segments.length === 0) return null;
  let totalWeight = 0;
  let weightedPitch = 0;
  for (const seg of segments) {
    const area = seg.stats?.areaMeters2 || seg.areaMeters2 || 1;
    const pitch = seg.pitchDegrees ?? 0;
    if (pitch < 1) continue;
    weightedPitch += pitch * area;
    totalWeight += area;
  }
  if (totalWeight === 0) return null;
  const dominantPitchDeg = weightedPitch / totalWeight;
  const dominantRise = pitchDegToRise(dominantPitchDeg);
  const bandMin = Math.max(0.5, dominantRise - 1);
  const bandMax = dominantRise + 1;
  return {
    pitch_deg: dominantPitchDeg,
    pitch_rise: Math.round(dominantRise * 10) / 10,
    band: [Math.round(bandMin * 10) / 10, Math.round(bandMax * 10) / 10],
  };
}

// ═══════════════════════════════════════════════════
// ASSEMBLY TEMPLATE RECOGNITION
// ═══════════════════════════════════════════════════

type AssemblyType = 'hip_body' | 'cross_gable' | 'nested_upper_hip' | 'valley_connector' | 'mirrored_wing';

interface AssemblyTemplate {
  type: AssemblyType;
  min_facets: number;
  max_facets: number;
  has_ridge: boolean;
  has_valley: boolean;
  symmetric: boolean;
}

const ASSEMBLY_TEMPLATES: AssemblyTemplate[] = [
  { type: 'hip_body', min_facets: 4, max_facets: 4, has_ridge: true, has_valley: false, symmetric: true },
  { type: 'cross_gable', min_facets: 2, max_facets: 4, has_ridge: true, has_valley: true, symmetric: false },
  { type: 'nested_upper_hip', min_facets: 3, max_facets: 4, has_ridge: true, has_valley: true, symmetric: true },
  { type: 'valley_connector', min_facets: 2, max_facets: 2, has_ridge: false, has_valley: true, symmetric: false },
  { type: 'mirrored_wing', min_facets: 3, max_facets: 6, has_ridge: true, has_valley: true, symmetric: true },
];

// ═══════════════════════════════════════════════════
// HARD IMPOSSIBILITY RULES
// ═══════════════════════════════════════════════════

interface ImpossibilityCheck {
  rule: string;
  check: (c: ConstraintCandidate, priors: SolarTopologyPrior, footprintPx: PxPt[], pxToSqft: number) => string | null;
}

const IMPOSSIBILITY_RULES: ImpossibilityCheck[] = [
  {
    rule: 'ridge_zero_on_complex_hip',
    check: (c, priors) => {
      if (c.faces.length < 4) return null;
      const ridges = c.edges.filter(e => e.type === 'ridge');
      const ridgeLf = ridges.reduce((s, e) => s + e.length_px, 0);
      if (ridgeLf === 0 && priors.expected_facet_count >= 4) {
        return 'ridge_lf=0 on complex hip roof — impossible topology';
      }
      return null;
    },
  },
  {
    rule: 'pitch_mismatch_solar',
    check: (c, priors) => {
      if (!priors.pitch_band) return null;
      const candRise = pitchDegToRise(priors.dominant_pitch_deg);
      if (candRise < priors.pitch_band[0] - 1 || candRise > priors.pitch_band[1] + 1) {
        return `pitch ${candRise.toFixed(1)}/12 outside Solar band [${priors.pitch_band[0]},${priors.pitch_band[1]}]`;
      }
      return null;
    },
  },
  {
    rule: 'giant_spanning_diagonal',
    check: (c, priors, footprintPx) => {
      const bbox = bboxOfPoly(footprintPx);
      const maxSpan = Math.hypot(bbox.width, bbox.height);
      for (const edge of c.edges) {
        if (edge.type === 'eave' || edge.type === 'rake') continue;
        if (edge.length_px > maxSpan * 0.50) {
          return `cross-roof diagonal ${edge.length_px.toFixed(0)}px exceeds 50% of span ${maxSpan.toFixed(0)}px`;
        }
      }
      return null;
    },
  },
  {
    rule: 'all_planes_converge_to_center',
    check: (c) => {
      if (c.faces.length < 4) return null;
      // Check if all interior edges share a single vertex (pyramid/fan)
      const interiorEdges = c.edges.filter(e => e.type !== 'eave' && e.type !== 'rake');
      if (interiorEdges.length < 3) return null;
      const vertexCounts = new Map<string, number>();
      for (const e of interiorEdges) {
        const ka = `${Math.round(e.a.x)},${Math.round(e.a.y)}`;
        const kb = `${Math.round(e.b.x)},${Math.round(e.b.y)}`;
        vertexCounts.set(ka, (vertexCounts.get(ka) || 0) + 1);
        vertexCounts.set(kb, (vertexCounts.get(kb) || 0) + 1);
      }
      for (const [, count] of vertexCounts) {
        if (count >= interiorEdges.length * 0.8) {
          return 'all planes converge to single center — pyramid/fan topology invalid for complex roof';
        }
      }
      return null;
    },
  },
  {
    rule: 'missing_valleys_on_complex',
    check: (c, priors) => {
      if (priors.inferred_valleys.length >= 2 && priors.expected_facet_count >= 8) {
        const valleys = c.edges.filter(e => e.type === 'valley');
        if (valleys.length === 0) {
          return 'expected valleys from Solar adjacency but topology has zero — missing assembly connections';
        }
      }
      return null;
    },
  },
  {
    rule: 'max_plane_dominance',
    check: (c, priors, footprintPx, pxToSqft) => {
      const totalArea = c.faces.reduce((s, f) => s + f.area_px, 0);
      if (totalArea === 0) return null;
      const maxFace = Math.max(...c.faces.map(f => f.area_px));
      if (maxFace / totalArea > 0.35 && priors.expected_facet_count >= 8) {
        return `single plane is ${((maxFace / totalArea) * 100).toFixed(0)}% of total — exceeds 35% limit for complex roof`;
      }
      return null;
    },
  },
];

function applyImpossibilityRules(
  candidate: ConstraintCandidate,
  priors: SolarTopologyPrior,
  footprintPx: PxPt[],
  pxToSqft: number,
): string | null {
  for (const rule of IMPOSSIBILITY_RULES) {
    const reason = rule.check(candidate, priors, footprintPx, pxToSqft);
    if (reason) return reason;
  }
  return null;
}

// ═══════════════════════════════════════════════════
// TOPOLOGY CANDIDATE GENERATOR
// ═══════════════════════════════════════════════════

function generateCandidates(
  footprintPx: PxPt[],
  priors: SolarTopologyPrior,
  dsmEdges: DSMEdgeEvidence[],
): ConstraintCandidate[] {
  const candidates: ConstraintCandidate[] = [];
  const fpBbox = bboxOfPoly(footprintPx);
  const fpCentroid = polygonCentroid(footprintPx);
  const isWide = fpBbox.width >= fpBbox.height;

  // 1. Simple hip (4 facets)
  candidates.push(generateSimpleHip(footprintPx, fpBbox, fpCentroid, isWide, priors, 'simple_hip'));

  // 2. Hip + cross gable (8-10 facets)
  if (priors.segments.length >= 4) {
    const cg = generateHipCrossGable(footprintPx, fpBbox, fpCentroid, isWide, priors);
    if (cg) candidates.push(cg);
  }

  // 3. Hip + nested upper assembly (10-14 facets)
  if (priors.segments.length >= 6) {
    const nested = generateHipNestedAssembly(footprintPx, fpBbox, fpCentroid, isWide, priors);
    if (nested) candidates.push(nested);
  }

  // 4. Solar-segment-driven topology
  if (priors.segments.length >= 3) {
    const solar = generateSolarDrivenTopology(footprintPx, fpBbox, fpCentroid, priors);
    if (solar) candidates.push(solar);
  }

  // 5. Multi-hip complex (12-16 facets)
  if (priors.segments.length >= 8) {
    const multi = generateMultiHipComplex(footprintPx, fpBbox, fpCentroid, isWide, priors);
    if (multi) candidates.push(multi);
  }

  // ── v2 NEW CANDIDATES ──

  // 6. Mirrored assembly (symmetric local hip wings connected by valleys)
  if (priors.segments.length >= 6) {
    const mirrored = generateMirroredAssembly(footprintPx, fpBbox, fpCentroid, isWide, priors);
    if (mirrored) candidates.push(mirrored);
  }

  // 7. Valley connector variant (hip body + valley-linked upper assemblies)
  if (priors.segments.length >= 5) {
    const valleyConn = generateValleyConnectorVariant(footprintPx, fpBbox, fpCentroid, isWide, priors);
    if (valleyConn) candidates.push(valleyConn);
  }

  // 8. Hierarchical assembly (explicit lower body + 2 upper local hip assemblies)
  if (priors.segments.length >= 8 && priors.expected_facet_count >= 10) {
    const hier = generateHierarchicalAssembly(footprintPx, fpBbox, fpCentroid, isWide, priors);
    if (hier) candidates.push(hier);
  }

  return candidates;
}

// ── Individual candidate generators ──

function generateSimpleHip(
  footprintPx: PxPt[], bbox: ReturnType<typeof bboxOfPoly>, centroid: PxPt,
  isWide: boolean, priors: SolarTopologyPrior, id: string,
): ConstraintCandidate {
  const ridgeInset = isWide ? bbox.width * 0.2 : bbox.height * 0.2;
  let ridgeA: PxPt, ridgeB: PxPt;
  if (isWide) {
    ridgeA = { x: bbox.minX + ridgeInset, y: centroid.y };
    ridgeB = { x: bbox.maxX - ridgeInset, y: centroid.y };
  } else {
    ridgeA = { x: centroid.x, y: bbox.minY + ridgeInset };
    ridgeB = { x: centroid.x, y: bbox.maxY - ridgeInset };
  }
  const corners = getFootprintCorners(footprintPx, bbox);
  const faces = buildHipFaces(corners, ridgeA, ridgeB, isWide, priors, footprintPx);
  const edges = buildEdgesFromFaces(faces, footprintPx);
  return { id, type: 'simple_hip', vertices: [ridgeA, ridgeB, ...corners], edges, faces, score: emptyScore(), rejected: false };
}

function generateHipCrossGable(
  footprintPx: PxPt[], bbox: ReturnType<typeof bboxOfPoly>, centroid: PxPt,
  isWide: boolean, priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  const splitRatio = 0.6;
  const mainBbox = { ...bbox };
  const extBbox = { ...bbox };
  if (isWide) {
    const splitX = bbox.minX + bbox.width * splitRatio;
    mainBbox.maxX = splitX; mainBbox.width = splitX - mainBbox.minX;
    extBbox.minX = splitX; extBbox.width = extBbox.maxX - splitX;
    extBbox.minY = bbox.minY + bbox.height * 0.15;
    extBbox.maxY = bbox.maxY - bbox.height * 0.15;
    extBbox.height = extBbox.maxY - extBbox.minY;
  } else {
    const splitY = bbox.minY + bbox.height * splitRatio;
    mainBbox.maxY = splitY; mainBbox.height = splitY - mainBbox.minY;
    extBbox.minY = splitY; extBbox.height = extBbox.maxY - splitY;
    extBbox.minX = bbox.minX + bbox.width * 0.15;
    extBbox.maxX = bbox.maxX - bbox.width * 0.15;
    extBbox.width = extBbox.maxX - extBbox.minX;
  }
  const mainC = { x: (mainBbox.minX + mainBbox.maxX) / 2, y: (mainBbox.minY + mainBbox.maxY) / 2 };
  const extC = { x: (extBbox.minX + extBbox.maxX) / 2, y: (extBbox.minY + extBbox.maxY) / 2 };
  const mainCorners = cornersFromBbox(mainBbox);
  const extCorners = cornersFromBbox(extBbox);
  const mInset = (isWide ? mainBbox.width : mainBbox.height) * 0.2;
  const eInset = (isWide ? extBbox.height : extBbox.width) * 0.2;
  let mRA: PxPt, mRB: PxPt, eRA: PxPt, eRB: PxPt;
  if (isWide) {
    mRA = { x: mainBbox.minX + mInset, y: mainC.y }; mRB = { x: mainBbox.maxX - mInset, y: mainC.y };
    eRA = { x: extC.x, y: extBbox.minY + eInset }; eRB = { x: extC.x, y: extBbox.maxY - eInset };
  } else {
    mRA = { x: mainC.x, y: mainBbox.minY + mInset }; mRB = { x: mainC.x, y: mainBbox.maxY - mInset };
    eRA = { x: extBbox.minX + eInset, y: extC.y }; eRB = { x: extBbox.maxX - eInset, y: extC.y };
  }
  const mainFaces = buildHipFaces(mainCorners, mRA, mRB, isWide, priors, footprintPx);
  const extFaces = buildHipFaces(extCorners, eRA, eRB, !isWide, priors, footprintPx);
  const junctionFaces = buildValleyJunctionFaces(mRB, eRA, mainCorners, extCorners, isWide, priors, footprintPx);
  const allFaces = [...mainFaces, ...extFaces, ...junctionFaces];
  const edges = buildEdgesFromFaces(allFaces, footprintPx);
  return {
    id: 'hip_cross_gable', type: 'hip_cross_gable',
    vertices: [mRA, mRB, eRA, eRB, ...mainCorners, ...extCorners],
    edges, faces: allFaces, score: emptyScore(), rejected: false,
  };
}

function generateHipNestedAssembly(
  footprintPx: PxPt[], bbox: ReturnType<typeof bboxOfPoly>, centroid: PxPt,
  isWide: boolean, priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  const mainCorners = cornersFromBbox(bbox);
  const mInset = (isWide ? bbox.width : bbox.height) * 0.2;
  let mRA: PxPt, mRB: PxPt;
  if (isWide) {
    mRA = { x: bbox.minX + mInset, y: centroid.y }; mRB = { x: bbox.maxX - mInset, y: centroid.y };
  } else {
    mRA = { x: centroid.x, y: bbox.minY + mInset }; mRB = { x: centroid.x, y: bbox.maxY - mInset };
  }
  const mainFaces = buildHipFaces(mainCorners, mRA, mRB, isWide, priors, footprintPx);
  const upperScale = 0.4;
  const upperBbox = {
    minX: centroid.x - bbox.width * upperScale / 2, maxX: centroid.x + bbox.width * upperScale / 2,
    minY: centroid.y - bbox.height * upperScale / 2, maxY: centroid.y + bbox.height * upperScale / 2,
    width: bbox.width * upperScale, height: bbox.height * upperScale,
  };
  const upperCorners = cornersFromBbox(upperBbox);
  const uInset = (isWide ? upperBbox.width : upperBbox.height) * 0.25;
  const uc = { x: (upperBbox.minX + upperBbox.maxX) / 2, y: (upperBbox.minY + upperBbox.maxY) / 2 };
  let uRA: PxPt, uRB: PxPt;
  if (isWide) {
    uRA = { x: upperBbox.minX + uInset, y: uc.y }; uRB = { x: upperBbox.maxX - uInset, y: uc.y };
  } else {
    uRA = { x: uc.x, y: upperBbox.minY + uInset }; uRB = { x: uc.x, y: upperBbox.maxY - uInset };
  }
  const upperFaces = buildHipFaces(upperCorners, uRA, uRB, isWide, priors, footprintPx);
  const valleyFaces: CandidateFace[] = [];
  for (let i = 0; i < upperCorners.length; i++) {
    const uc2 = upperCorners[i];
    let nearest = mainCorners[0]; let nd = Infinity;
    for (const mc of mainCorners) { const d = ptDist(uc2, mc); if (d < nd) { nd = d; nearest = mc; } }
    const tri: PxPt[] = [uc2, nearest, upperCorners[(i + 1) % upperCorners.length]];
    valleyFaces.push({ polygon_px: tri, area_px: polygonAreaPx(tri), pitch_deg: priors.dominant_pitch_deg, azimuth_deg: inferAzimuth(tri, footprintPx), matched_solar_segment: null });
  }
  const allFaces = [...mainFaces, ...upperFaces, ...valleyFaces];
  const edges = buildEdgesFromFaces(allFaces, footprintPx);
  return {
    id: 'hip_nested_assembly', type: 'hip_nested_assembly',
    vertices: [mRA, mRB, uRA, uRB, ...mainCorners, ...upperCorners],
    edges, faces: allFaces, score: emptyScore(), rejected: false,
  };
}

function generateSolarDrivenTopology(
  footprintPx: PxPt[], bbox: ReturnType<typeof bboxOfPoly>, centroid: PxPt,
  priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  const segmentsWithCenters = priors.segments.filter(s => s.center_px != null);
  if (segmentsWithCenters.length < 2) return null;
  const faces: CandidateFace[] = [];
  const fpArea = polygonAreaPx(footprintPx);
  for (const seg of priors.segments) {
    if (!seg.bbox_px) continue;
    const clipped = clipPolygonToRect(footprintPx, seg.bbox_px);
    if (clipped.length < 3) continue;
    const area = polygonAreaPx(clipped);
    if (area < fpArea * 0.02) continue;
    faces.push({ polygon_px: clipped, area_px: area, pitch_deg: seg.pitch_deg, azimuth_deg: seg.azimuth_deg, matched_solar_segment: seg.index });
  }
  if (faces.length < 3) return null;
  const edges = buildEdgesFromFaces(faces, footprintPx);
  for (const edge of edges) {
    if (edge.type !== 'eave' && edge.type !== 'rake') {
      const adjFaces = findAdjacentFaces(edge, faces);
      if (adjFaces.length === 2) {
        if (areOpposingAzimuths(adjFaces[0].azimuth_deg, adjFaces[1].azimuth_deg)) edge.type = 'ridge';
        else if (areConvergingAzimuths(adjFaces[0].azimuth_deg, adjFaces[1].azimuth_deg)) edge.type = 'valley';
        else edge.type = 'hip';
      }
    }
  }
  return {
    id: 'solar_driven', type: 'solar_driven',
    vertices: faces.flatMap(f => f.polygon_px), edges, faces, score: emptyScore(), rejected: false,
  };
}

function generateMultiHipComplex(
  footprintPx: PxPt[], bbox: ReturnType<typeof bboxOfPoly>, centroid: PxPt,
  isWide: boolean, priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  const sections = 3;
  const allFaces: CandidateFace[] = [];
  const allVertices: PxPt[] = [];
  for (let s = 0; s < sections; s++) {
    const t0 = s / sections, t1 = (s + 1) / sections;
    const secBbox = { ...bbox };
    if (isWide) {
      secBbox.minX = bbox.minX + bbox.width * t0; secBbox.maxX = bbox.minX + bbox.width * t1;
      secBbox.width = secBbox.maxX - secBbox.minX;
    } else {
      secBbox.minY = bbox.minY + bbox.height * t0; secBbox.maxY = bbox.minY + bbox.height * t1;
      secBbox.height = secBbox.maxY - secBbox.minY;
    }
    const sc = cornersFromBbox(secBbox);
    const sCenter = { x: (secBbox.minX + secBbox.maxX) / 2, y: (secBbox.minY + secBbox.maxY) / 2 };
    const inset = (isWide ? secBbox.width : secBbox.height) * 0.2;
    let rA: PxPt, rB: PxPt;
    if (isWide) { rA = { x: secBbox.minX + inset, y: sCenter.y }; rB = { x: secBbox.maxX - inset, y: sCenter.y }; }
    else { rA = { x: sCenter.x, y: secBbox.minY + inset }; rB = { x: sCenter.x, y: secBbox.maxY - inset }; }
    allFaces.push(...buildHipFaces(sc, rA, rB, isWide, priors, footprintPx));
    allVertices.push(rA, rB, ...sc);
  }
  const edges = buildEdgesFromFaces(allFaces, footprintPx);
  return {
    id: 'multi_hip_complex', type: 'multi_hip_complex',
    vertices: allVertices, edges, faces: allFaces, score: emptyScore(), rejected: false,
  };
}

// ── v2 NEW CANDIDATE GENERATORS ──

/**
 * Mirrored assembly: Two symmetric hip wings on either side of a central ridge,
 * connected by valleys. Models roofs like Fonsica where the structure is
 * bilaterally symmetric.
 */
function generateMirroredAssembly(
  footprintPx: PxPt[], bbox: ReturnType<typeof bboxOfPoly>, centroid: PxPt,
  isWide: boolean, priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  // Split into left wing + central body + right wing
  const allFaces: CandidateFace[] = [];
  const allVertices: PxPt[] = [];

  // Central body (wider ridge)
  const centralWidth = isWide ? bbox.width * 0.5 : bbox.height * 0.5;
  const wingWidth = isWide ? bbox.width * 0.25 : bbox.height * 0.25;

  // Central hip body
  const cBbox = {
    minX: isWide ? centroid.x - centralWidth / 2 : bbox.minX,
    maxX: isWide ? centroid.x + centralWidth / 2 : bbox.maxX,
    minY: isWide ? bbox.minY : centroid.y - centralWidth / 2,
    maxY: isWide ? bbox.maxY : centroid.y + centralWidth / 2,
    width: isWide ? centralWidth : bbox.width,
    height: isWide ? bbox.height : centralWidth,
  };
  const cCorners = cornersFromBbox(cBbox);
  const cInset = (isWide ? cBbox.width : cBbox.height) * 0.15;
  const cCenter = { x: (cBbox.minX + cBbox.maxX) / 2, y: (cBbox.minY + cBbox.maxY) / 2 };
  let cRA: PxPt, cRB: PxPt;
  if (isWide) {
    cRA = { x: cBbox.minX + cInset, y: cCenter.y }; cRB = { x: cBbox.maxX - cInset, y: cCenter.y };
  } else {
    cRA = { x: cCenter.x, y: cBbox.minY + cInset }; cRB = { x: cCenter.x, y: cBbox.maxY - cInset };
  }
  const centralFaces = buildHipFaces(cCorners, cRA, cRB, isWide, priors, footprintPx);
  allFaces.push(...centralFaces);
  allVertices.push(cRA, cRB, ...cCorners);

  // Left wing (mirror of right)
  for (const side of [-1, 1]) {
    const wBbox = { ...bbox };
    if (isWide) {
      if (side === -1) { wBbox.maxX = cBbox.minX; wBbox.minX = bbox.minX; }
      else { wBbox.minX = cBbox.maxX; wBbox.maxX = bbox.maxX; }
      wBbox.width = wBbox.maxX - wBbox.minX;
      // Narrow the wing vertically (upper assembly)
      wBbox.minY = bbox.minY + bbox.height * 0.1;
      wBbox.maxY = bbox.maxY - bbox.height * 0.1;
      wBbox.height = wBbox.maxY - wBbox.minY;
    } else {
      if (side === -1) { wBbox.maxY = cBbox.minY; wBbox.minY = bbox.minY; }
      else { wBbox.minY = cBbox.maxY; wBbox.maxY = bbox.maxY; }
      wBbox.height = wBbox.maxY - wBbox.minY;
      wBbox.minX = bbox.minX + bbox.width * 0.1;
      wBbox.maxX = bbox.maxX - bbox.width * 0.1;
      wBbox.width = wBbox.maxX - wBbox.minX;
    }
    if (wBbox.width < 10 || wBbox.height < 10) continue;
    const wCorners = cornersFromBbox(wBbox);
    const wCenter = { x: (wBbox.minX + wBbox.maxX) / 2, y: (wBbox.minY + wBbox.maxY) / 2 };
    const wInset = (isWide ? wBbox.width : wBbox.height) * 0.2;
    let wRA: PxPt, wRB: PxPt;
    if (isWide) {
      wRA = { x: wBbox.minX + wInset, y: wCenter.y }; wRB = { x: wBbox.maxX - wInset, y: wCenter.y };
    } else {
      wRA = { x: wCenter.x, y: wBbox.minY + wInset }; wRB = { x: wCenter.x, y: wBbox.maxY - wInset };
    }
    const wingFaces = buildHipFaces(wCorners, wRA, wRB, isWide, priors, footprintPx);
    allFaces.push(...wingFaces);
    allVertices.push(wRA, wRB, ...wCorners);

    // Valley connector between wing and central body
    const junctionFaces = buildValleyJunctionFaces(
      side === -1 ? cRA : cRB,
      side === -1 ? wRB : wRA,
      cCorners, wCorners, isWide, priors, footprintPx,
    );
    allFaces.push(...junctionFaces);
  }

  const edges = buildEdgesFromFaces(allFaces, footprintPx);
  return {
    id: 'mirrored_assembly', type: 'mirrored_assembly',
    vertices: allVertices, edges, faces: allFaces, score: emptyScore(), rejected: false,
  };
}

/**
 * Valley connector variant: Main hip body with two small upper hip assemblies
 * connected via valley lines — no perpendicular gable wings, just valley connectors.
 */
function generateValleyConnectorVariant(
  footprintPx: PxPt[], bbox: ReturnType<typeof bboxOfPoly>, centroid: PxPt,
  isWide: boolean, priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  const allFaces: CandidateFace[] = [];
  const allVertices: PxPt[] = [];

  // Main hip body (full footprint)
  const mainCorners = cornersFromBbox(bbox);
  const mInset = (isWide ? bbox.width : bbox.height) * 0.2;
  let mRA: PxPt, mRB: PxPt;
  if (isWide) {
    mRA = { x: bbox.minX + mInset, y: centroid.y }; mRB = { x: bbox.maxX - mInset, y: centroid.y };
  } else {
    mRA = { x: centroid.x, y: bbox.minY + mInset }; mRB = { x: centroid.x, y: bbox.maxY - mInset };
  }
  const mainFaces = buildHipFaces(mainCorners, mRA, mRB, isWide, priors, footprintPx);
  allFaces.push(...mainFaces);
  allVertices.push(mRA, mRB, ...mainCorners);

  // Two upper assemblies on one side (e.g., front/top)
  for (const offset of [0.3, 0.7]) {
    const uScale = 0.25;
    let uCenter: PxPt;
    if (isWide) {
      uCenter = { x: bbox.minX + bbox.width * offset, y: bbox.minY + bbox.height * 0.25 };
    } else {
      uCenter = { x: bbox.minX + bbox.width * 0.25, y: bbox.minY + bbox.height * offset };
    }
    const uBbox = {
      minX: uCenter.x - bbox.width * uScale / 2,
      maxX: uCenter.x + bbox.width * uScale / 2,
      minY: uCenter.y - bbox.height * uScale / 2,
      maxY: uCenter.y + bbox.height * uScale / 2,
      width: bbox.width * uScale,
      height: bbox.height * uScale,
    };
    const uCorners = cornersFromBbox(uBbox);
    const uInset = (isWide ? uBbox.width : uBbox.height) * 0.25;
    const uc = { x: (uBbox.minX + uBbox.maxX) / 2, y: (uBbox.minY + uBbox.maxY) / 2 };
    let uRA: PxPt, uRB: PxPt;
    if (isWide) {
      uRA = { x: uBbox.minX + uInset, y: uc.y }; uRB = { x: uBbox.maxX - uInset, y: uc.y };
    } else {
      uRA = { x: uc.x, y: uBbox.minY + uInset }; uRB = { x: uc.x, y: uBbox.maxY - uInset };
    }
    const uFaces = buildHipFaces(uCorners, uRA, uRB, isWide, priors, footprintPx);
    allFaces.push(...uFaces);
    allVertices.push(uRA, uRB, ...uCorners);

    // Valley connector triangles
    const ridgePt = isWide
      ? lerp(mRA, mRB, offset)
      : lerp(mRA, mRB, offset);
    for (let i = 0; i < uCorners.length; i++) {
      const a = uCorners[i];
      const b = uCorners[(i + 1) % uCorners.length];
      const m = midpoint(a, b);
      if (ptDist(m, ridgePt) < Math.max(bbox.width, bbox.height) * 0.3) {
        const tri: PxPt[] = [a, b, ridgePt];
        allFaces.push({
          polygon_px: tri, area_px: polygonAreaPx(tri), pitch_deg: priors.dominant_pitch_deg,
          azimuth_deg: inferAzimuth(tri, footprintPx), matched_solar_segment: null,
        });
      }
    }
  }

  const edges = buildEdgesFromFaces(allFaces, footprintPx);
  return {
    id: 'valley_connector', type: 'valley_connector',
    vertices: allVertices, edges, faces: allFaces, score: emptyScore(), rejected: false,
  };
}

/**
 * Hierarchical assembly: Explicit modeling of the Fonsica-like structure:
 * - Large lower hip body
 * - Central ridge connector
 * - Two upper local hip assemblies (left + right)
 * - Mirrored valley systems connecting upper to lower
 */
function generateHierarchicalAssembly(
  footprintPx: PxPt[], bbox: ReturnType<typeof bboxOfPoly>, centroid: PxPt,
  isWide: boolean, priors: SolarTopologyPrior,
): ConstraintCandidate | null {
  const allFaces: CandidateFace[] = [];
  const allVertices: PxPt[] = [];

  // Lower body occupies full width, ~60% of depth
  const lowerBbox = { ...bbox };
  if (isWide) {
    lowerBbox.minY = bbox.minY + bbox.height * 0.4;
    lowerBbox.height = bbox.maxY - lowerBbox.minY;
  } else {
    lowerBbox.minX = bbox.minX + bbox.width * 0.4;
    lowerBbox.width = bbox.maxX - lowerBbox.minX;
  }
  const lCorners = cornersFromBbox(lowerBbox);
  const lCenter = { x: (lowerBbox.minX + lowerBbox.maxX) / 2, y: (lowerBbox.minY + lowerBbox.maxY) / 2 };
  const lInset = (isWide ? lowerBbox.width : lowerBbox.height) * 0.15;
  let lRA: PxPt, lRB: PxPt;
  if (isWide) {
    lRA = { x: lowerBbox.minX + lInset, y: lCenter.y }; lRB = { x: lowerBbox.maxX - lInset, y: lCenter.y };
  } else {
    lRA = { x: lCenter.x, y: lowerBbox.minY + lInset }; lRB = { x: lCenter.x, y: lowerBbox.maxY - lInset };
  }
  allFaces.push(...buildHipFaces(lCorners, lRA, lRB, isWide, priors, footprintPx));
  allVertices.push(lRA, lRB, ...lCorners);

  // Two upper assemblies, each ~40% wide, occupying the upper 40%
  for (const side of [0, 1]) {
    const uBbox = { ...bbox };
    if (isWide) {
      uBbox.maxY = bbox.minY + bbox.height * 0.45; // Overlap slightly for valley
      uBbox.height = uBbox.maxY - uBbox.minY;
      uBbox.minX = side === 0 ? bbox.minX : centroid.x + bbox.width * 0.05;
      uBbox.maxX = side === 0 ? centroid.x - bbox.width * 0.05 : bbox.maxX;
      uBbox.width = uBbox.maxX - uBbox.minX;
    } else {
      uBbox.maxX = bbox.minX + bbox.width * 0.45;
      uBbox.width = uBbox.maxX - uBbox.minX;
      uBbox.minY = side === 0 ? bbox.minY : centroid.y + bbox.height * 0.05;
      uBbox.maxY = side === 0 ? centroid.y - bbox.height * 0.05 : bbox.maxY;
      uBbox.height = uBbox.maxY - uBbox.minY;
    }
    if (uBbox.width < 10 || uBbox.height < 10) continue;
    const uCorners = cornersFromBbox(uBbox);
    const uCenter = { x: (uBbox.minX + uBbox.maxX) / 2, y: (uBbox.minY + uBbox.maxY) / 2 };
    const uInset = (isWide ? uBbox.width : uBbox.height) * 0.2;
    let uRA: PxPt, uRB: PxPt;
    if (isWide) {
      uRA = { x: uBbox.minX + uInset, y: uCenter.y }; uRB = { x: uBbox.maxX - uInset, y: uCenter.y };
    } else {
      uRA = { x: uCenter.x, y: uBbox.minY + uInset }; uRB = { x: uCenter.x, y: uBbox.maxY - uInset };
    }
    const uFaces = buildHipFaces(uCorners, uRA, uRB, isWide, priors, footprintPx);
    allFaces.push(...uFaces);
    allVertices.push(uRA, uRB, ...uCorners);

    // Valley connectors between upper assembly and lower body
    const junctPt = isWide
      ? (side === 0 ? lRA : lRB)
      : (side === 0 ? lRA : lRB);
    const nearRidge = isWide
      ? (side === 0 ? uRB : uRA)
      : (side === 0 ? uRB : uRA);
    const jFaces = buildValleyJunctionFaces(junctPt, nearRidge, lCorners, uCorners, isWide, priors, footprintPx);
    allFaces.push(...jFaces);
  }

  const edges = buildEdgesFromFaces(allFaces, footprintPx);
  return {
    id: 'hierarchical_assembly', type: 'hierarchical_assembly',
    vertices: allVertices, edges, faces: allFaces, score: emptyScore(), rejected: false,
  };
}

// ═══════════════════════════════════════════════════
// FACE / EDGE BUILDING HELPERS
// ═══════════════════════════════════════════════════

function buildHipFaces(
  corners: PxPt[], ridgeA: PxPt, ridgeB: PxPt, isWide: boolean,
  priors: SolarTopologyPrior, footprintPx: PxPt[],
): CandidateFace[] {
  const [tl, tr, br, bl] = corners;
  const faces: CandidateFace[] = [];
  if (isWide) {
    faces.push(makeFace([tl, tr, ridgeB, ridgeA], priors, footprintPx));
    faces.push(makeFace([bl, ridgeA, ridgeB, br], priors, footprintPx));
    faces.push(makeFace([tl, ridgeA, bl], priors, footprintPx));
    faces.push(makeFace([tr, br, ridgeB], priors, footprintPx));
  } else {
    faces.push(makeFace([tl, ridgeA, ridgeB, bl], priors, footprintPx));
    faces.push(makeFace([tr, br, ridgeB, ridgeA], priors, footprintPx));
    faces.push(makeFace([tl, tr, ridgeA], priors, footprintPx));
    faces.push(makeFace([bl, ridgeB, br], priors, footprintPx));
  }
  return faces;
}

function buildValleyJunctionFaces(
  mainRidgeEnd: PxPt, extRidgeStart: PxPt,
  mainCorners: PxPt[], extCorners: PxPt[],
  isWide: boolean, priors: SolarTopologyPrior, footprintPx: PxPt[],
): CandidateFace[] {
  const faces: CandidateFace[] = [];
  const junctionMid = midpoint(mainRidgeEnd, extRidgeStart);
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
  return {
    polygon_px: polygon,
    area_px: polygonAreaPx(polygon),
    pitch_deg: priors.dominant_pitch_deg,
    azimuth_deg: inferAzimuth(polygon, footprintPx),
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
        edgeMap.set(key, {
          a, b,
          type: isEdgeOnPerimeter(a, b, footprintPx) ? 'eave' : 'hip',
          length_px: ptDist(a, b),
          source: 'constraint_solver',
        });
      }
    }
  }
  return Array.from(edgeMap.values());
}

// ═══════════════════════════════════════════════════
// CONSTRAINT SCORING (v2 — expanded)
// ═══════════════════════════════════════════════════

const WEIGHTS = {
  area_error: 0.15,
  pitch_error: 0.12,
  segment_area_agreement: 0.12,
  segment_azimuth_agreement: 0.08,
  dsm_edge_support: 0.08,
  perimeter_compatibility: 0.08,
  construction_plausibility: 0.10,
  facet_count_penalty: 0.05,
  max_plane_area_ratio: 0.05,
  // v2 additions
  symmetry_score: 0.07,
  ridge_valley_continuity: 0.05,
  assembly_hierarchy: 0.05,
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

  // 1. Area error
  const candidateAreaSqft = totalCandArea * pxToSqft * pitchFactor(priors.dominant_pitch_deg);
  const areaTarget = priors.whole_roof_area_sqft || priors.total_pitched_area_sqft;
  const areaErrorPct = areaTarget > 0 ? Math.abs(candidateAreaSqft - areaTarget) / areaTarget : 0.5;
  const areaScore = Math.max(0, 1 - areaErrorPct * 5);

  // 2. Pitch error
  const pitchError = Math.abs(pitchDegToRise(priors.dominant_pitch_deg) - priors.dominant_pitch_rise);
  const pitchScore = Math.max(0, 1 - pitchError / 3);

  // 3. Segment area agreement
  let segAreaScore = 0.5;
  if (priors.segments.length > 0) {
    let matchedArea = 0, totalSegArea = 0;
    for (const seg of priors.segments) {
      totalSegArea += seg.area_sqft;
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
    let azMatchSum = 0, azCount = 0;
    for (const seg of priors.segments) {
      for (const face of candidate.faces) {
        if (face.matched_solar_segment === seg.index) {
          const azDiff = Math.min(Math.abs(face.azimuth_deg - seg.azimuth_deg), 360 - Math.abs(face.azimuth_deg - seg.azimuth_deg));
          azMatchSum += Math.max(0, 1 - azDiff / 90);
          azCount++;
        }
      }
    }
    if (azCount > 0) segAzScore = azMatchSum / azCount;
  }

  // 5. DSM edge support
  let dsmScore = 0.3;
  if (dsmEdges.length > 0) {
    let supportedEdges = 0;
    const interiorEdges = candidate.edges.filter(e => e.type !== 'eave' && e.type !== 'rake');
    for (const ce of interiorEdges) {
      const cem = midpoint(ce.a, ce.b);
      for (const de of dsmEdges) {
        const dem = midpoint(de.a, de.b);
        if (ptDist(cem, dem) < 20) { supportedEdges++; break; }
      }
    }
    dsmScore = interiorEdges.length > 0 ? supportedEdges / interiorEdges.length : 0.3;
  }

  // 6. Perimeter compatibility
  const perimeterScore = totalCandArea > 0 ? Math.min(1, totalCandArea / fpArea) : 0;

  // 7. Construction plausibility
  let plausScore = 1.0;
  const ridgeEdges = candidate.edges.filter(e => e.type === 'ridge');
  const valleyEdges = candidate.edges.filter(e => e.type === 'valley');
  if (ridgeEdges.length === 0 && candidate.faces.length >= 4) plausScore -= 0.4;
  if (candidate.faces.length < 3 && priors.expected_facet_count > 6) plausScore -= 0.3;
  // Penalize isolated faces (tiny area)
  const tinyFaces = candidate.faces.filter(f => f.area_px < fpArea * 0.01).length;
  plausScore -= tinyFaces * 0.05;
  plausScore = Math.max(0, plausScore);

  // 8. Facet count penalty
  const facetDiff = Math.abs(candidate.faces.length - priors.expected_facet_count);
  const facetScore = Math.max(0, 1 - facetDiff / Math.max(priors.expected_facet_count, 4) * 2);

  // 9. Max plane area ratio
  const maxFaceArea = Math.max(...candidate.faces.map(f => f.area_px));
  const maxPlaneRatio = totalCandArea > 0 ? maxFaceArea / totalCandArea : 1;
  const planeRatioScore = Math.max(0, 1 - Math.max(0, maxPlaneRatio - 0.25) * 4);

  // ── v2 ADDITIONS ──

  // 10. Symmetry score
  const symmetryScore = computeSymmetryScore(candidate, footprintPx);

  // 11. Ridge/valley continuity
  const rvContinuity = computeRidgeValleyContinuity(candidate);

  // 12. Assembly hierarchy score
  const assemblyScore = computeAssemblyHierarchy(candidate, priors);

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
    symmetry_score: symmetryScore,
    ridge_valley_continuity: rvContinuity,
    assembly_hierarchy: assemblyScore,
    total: 0,
  };

  score.total =
    score.area_error * WEIGHTS.area_error +
    score.pitch_error * WEIGHTS.pitch_error +
    score.segment_area_agreement * WEIGHTS.segment_area_agreement +
    score.segment_azimuth_agreement * WEIGHTS.segment_azimuth_agreement +
    score.dsm_edge_support * WEIGHTS.dsm_edge_support +
    score.perimeter_compatibility * WEIGHTS.perimeter_compatibility +
    score.construction_plausibility * WEIGHTS.construction_plausibility +
    score.facet_count_penalty * WEIGHTS.facet_count_penalty +
    score.max_plane_area_ratio * WEIGHTS.max_plane_area_ratio +
    score.symmetry_score * WEIGHTS.symmetry_score +
    score.ridge_valley_continuity * WEIGHTS.ridge_valley_continuity +
    score.assembly_hierarchy * WEIGHTS.assembly_hierarchy;

  return score;
}

// ── v2 Scoring Helpers ──

function computeSymmetryScore(candidate: ConstraintCandidate, footprintPx: PxPt[]): number {
  if (candidate.faces.length < 4) return 0.5;
  const bbox = bboxOfPoly(footprintPx);
  const centerX = (bbox.minX + bbox.maxX) / 2;
  const centerY = (bbox.minY + bbox.maxY) / 2;

  // Check bilateral symmetry along dominant axis
  const leftFaces = candidate.faces.filter(f => polygonCentroid(f.polygon_px).x < centerX);
  const rightFaces = candidate.faces.filter(f => polygonCentroid(f.polygon_px).x >= centerX);

  if (leftFaces.length === 0 || rightFaces.length === 0) return 0.3;

  // Compare area distributions
  const leftAreas = leftFaces.map(f => f.area_px).sort((a, b) => b - a);
  const rightAreas = rightFaces.map(f => f.area_px).sort((a, b) => b - a);

  let symmetrySum = 0;
  const maxLen = Math.max(leftAreas.length, rightAreas.length);
  for (let i = 0; i < maxLen; i++) {
    const lA = leftAreas[i] || 0;
    const rA = rightAreas[i] || 0;
    const maxA = Math.max(lA, rA);
    if (maxA > 0) symmetrySum += Math.min(lA, rA) / maxA;
  }

  const countSymmetry = 1 - Math.abs(leftFaces.length - rightFaces.length) / Math.max(leftFaces.length, rightFaces.length);
  return (symmetrySum / maxLen * 0.6 + countSymmetry * 0.4);
}

function computeRidgeValleyContinuity(candidate: ConstraintCandidate): number {
  const ridges = candidate.edges.filter(e => e.type === 'ridge');
  const valleys = candidate.edges.filter(e => e.type === 'valley');

  if (ridges.length === 0 && candidate.faces.length >= 4) return 0.1;
  if (ridges.length === 0 && valleys.length === 0) return 0.5;

  // Check ridge chain connectivity: ridges should form connected chains
  let ridgeContinuity = 1.0;
  if (ridges.length >= 2) {
    let connected = 0;
    for (let i = 0; i < ridges.length; i++) {
      for (let j = i + 1; j < ridges.length; j++) {
        const dist = Math.min(
          ptDist(ridges[i].a, ridges[j].a), ptDist(ridges[i].a, ridges[j].b),
          ptDist(ridges[i].b, ridges[j].a), ptDist(ridges[i].b, ridges[j].b),
        );
        if (dist < 10) connected++;
      }
    }
    ridgeContinuity = Math.min(1, connected / Math.max(1, ridges.length - 1));
  }

  // Valley continuity: valleys should connect to ridge endpoints or perimeter
  let valleyContinuity = 1.0;
  if (valleys.length > 0 && ridges.length > 0) {
    let connectedValleys = 0;
    for (const v of valleys) {
      let connected = false;
      for (const r of ridges) {
        const dist = Math.min(ptDist(v.a, r.a), ptDist(v.a, r.b), ptDist(v.b, r.a), ptDist(v.b, r.b));
        if (dist < 15) { connected = true; break; }
      }
      if (connected) connectedValleys++;
    }
    valleyContinuity = connectedValleys / valleys.length;
  }

  return ridgeContinuity * 0.6 + valleyContinuity * 0.4;
}

function computeAssemblyHierarchy(candidate: ConstraintCandidate, priors: SolarTopologyPrior): number {
  if (candidate.faces.length < 6) return 0.5;

  // Check for hierarchical structure: some faces should be significantly larger (body)
  // and some smaller (upper assemblies)
  const areas = candidate.faces.map(f => f.area_px).sort((a, b) => b - a);
  const totalArea = areas.reduce((s, a) => s + a, 0);

  // Expect a mix of large (body) and small (assembly) faces
  const largeThreshold = totalArea * 0.15;
  const largeFaces = areas.filter(a => a >= largeThreshold).length;
  const smallFaces = areas.filter(a => a < largeThreshold).length;

  // Good hierarchy: 3-5 large faces + multiple smaller ones
  let hierarchyScore = 0.5;
  if (largeFaces >= 2 && largeFaces <= 6 && smallFaces >= 2) {
    hierarchyScore = 0.8;
  }
  if (largeFaces >= 3 && smallFaces >= 4 && priors.expected_facet_count >= 10) {
    hierarchyScore = 1.0;
  }

  // Penalize if all faces are roughly equal (no hierarchy)
  const areaStdev = Math.sqrt(areas.reduce((s, a) => s + (a - totalArea / areas.length) ** 2, 0) / areas.length);
  const cv = totalArea > 0 ? areaStdev / (totalArea / areas.length) : 0;
  if (cv < 0.2) hierarchyScore *= 0.6; // Too uniform

  return hierarchyScore;
}

// ═══════════════════════════════════════════════════
// GRAPH OPTIMIZATION LOOP (v2 — expanded operations)
// ═══════════════════════════════════════════════════

type OptMove = 'vertex_move' | 'split_face' | 'merge_faces' | 'insert_ridge' | 'remove_diagonal' | 'reclassify_edge';

function optimizeCandidate(
  candidate: ConstraintCandidate,
  priors: SolarTopologyPrior,
  footprintPx: PxPt[],
  dsmEdges: DSMEdgeEvidence[],
  pxToSqft: number,
): { candidate: ConstraintCandidate; iterations: number; moves: string[] } {
  let best = candidate;
  let bestScore = candidate.score.total;
  let iterations = 0;
  const maxIterations = 50;
  let plateau = 0;
  const moves: string[] = [];

  while (iterations < maxIterations && plateau < 6) {
    iterations++;
    let improved = false;

    // ── Move 1: Vertex perturbation ──
    for (let vi = 0; vi < best.vertices.length && !improved; vi++) {
      const v = best.vertices[vi];
      if (isEdgeOnPerimeter(v, v, footprintPx)) continue;
      for (const delta of [
        { x: 4, y: 0 }, { x: -4, y: 0 }, { x: 0, y: 4 }, { x: 0, y: -4 },
        { x: 3, y: 3 }, { x: -3, y: 3 }, { x: 3, y: -3 }, { x: -3, y: -3 },
      ]) {
        const moved = { x: v.x + delta.x, y: v.y + delta.y };
        const nc = cloneCandidateWithMovedVertex(best, vi, moved, priors, footprintPx);
        const ns = scoreCandidate(nc, priors, footprintPx, dsmEdges, pxToSqft);
        if (ns.total > bestScore) {
          nc.score = ns; best = nc; bestScore = ns.total; improved = true;
          moves.push(`vertex_move_${vi}_by_${delta.x},${delta.y}`);
          break;
        }
      }
    }

    // ── Move 2: Split oversized face ──
    if (!improved) {
      const totalArea = best.faces.reduce((s, f) => s + f.area_px, 0);
      for (let fi = 0; fi < best.faces.length && !improved; fi++) {
        const face = best.faces[fi];
        if (face.area_px / totalArea > 0.30 && face.polygon_px.length >= 4) {
          const nc = cloneCandidateWithSplitFace(best, fi, priors, footprintPx);
          if (nc) {
            const ns = scoreCandidate(nc, priors, footprintPx, dsmEdges, pxToSqft);
            if (ns.total > bestScore) {
              nc.score = ns; best = nc; bestScore = ns.total; improved = true;
              moves.push(`split_face_${fi}`);
            }
          }
        }
      }
    }

    // ── Move 3: Remove long diagonal edges ──
    if (!improved) {
      const bboxDiag = Math.hypot(
        bboxOfPoly(footprintPx).width, bboxOfPoly(footprintPx).height
      );
      for (let ei = 0; ei < best.edges.length && !improved; ei++) {
        const edge = best.edges[ei];
        if (edge.type === 'eave' || edge.type === 'rake') continue;
        if (edge.length_px > bboxDiag * 0.45) {
          const nc = cloneCandidateWithoutEdge(best, ei, priors, footprintPx);
          if (nc) {
            const ns = scoreCandidate(nc, priors, footprintPx, dsmEdges, pxToSqft);
            if (ns.total > bestScore) {
              nc.score = ns; best = nc; bestScore = ns.total; improved = true;
              moves.push(`remove_diagonal_${ei}`);
            }
          }
        }
      }
    }

    // ── Move 4: Reclassify edge types ──
    if (!improved) {
      for (let ei = 0; ei < best.edges.length && !improved; ei++) {
        const edge = best.edges[ei];
        if (edge.type === 'eave' || edge.type === 'rake') continue;
        const originalType = edge.type;
        for (const newType of ['ridge', 'hip', 'valley'] as const) {
          if (newType === originalType) continue;
          const nc = cloneCandidateWithReclassifiedEdge(best, ei, newType, priors, footprintPx);
          const ns = scoreCandidate(nc, priors, footprintPx, dsmEdges, pxToSqft);
          if (ns.total > bestScore) {
            nc.score = ns; best = nc; bestScore = ns.total; improved = true;
            moves.push(`reclassify_edge_${ei}_${originalType}_to_${newType}`);
            break;
          }
        }
      }
    }

    if (!improved) plateau++;
    else plateau = 0;
  }

  return { candidate: best, iterations, moves };
}

// ── Optimization mutation helpers ──

function cloneCandidateWithMovedVertex(
  original: ConstraintCandidate, vertexIndex: number, newPos: PxPt,
  priors: SolarTopologyPrior, footprintPx: PxPt[],
): ConstraintCandidate {
  const oldPos = original.vertices[vertexIndex];
  const vertices = original.vertices.map((v, i) => i === vertexIndex ? newPos : { ...v });
  const faces = original.faces.map(f => {
    const newPoly = f.polygon_px.map(p => ptDist(p, oldPos) < 2 ? newPos : { ...p });
    return { ...f, polygon_px: newPoly, area_px: polygonAreaPx(newPoly), azimuth_deg: inferAzimuth(newPoly, footprintPx) };
  });
  const edges = buildEdgesFromFaces(faces, footprintPx);
  return { ...original, vertices, faces, edges, score: emptyScore() };
}

function cloneCandidateWithSplitFace(
  original: ConstraintCandidate, faceIndex: number,
  priors: SolarTopologyPrior, footprintPx: PxPt[],
): ConstraintCandidate | null {
  const face = original.faces[faceIndex];
  if (face.polygon_px.length < 4) return null;

  // Split the face by connecting midpoints of the two longest edges
  const poly = face.polygon_px;
  const edgeLens: Array<{ idx: number; len: number }> = [];
  for (let i = 0; i < poly.length; i++) {
    edgeLens.push({ idx: i, len: ptDist(poly[i], poly[(i + 1) % poly.length]) });
  }
  edgeLens.sort((a, b) => b.len - a.len);

  const e1 = edgeLens[0].idx;
  const e2 = edgeLens.length > 1 ? edgeLens[1].idx : (e1 + 2) % poly.length;
  const m1 = midpoint(poly[e1], poly[(e1 + 1) % poly.length]);
  const m2 = midpoint(poly[e2], poly[(e2 + 1) % poly.length]);

  // Build two sub-polygons
  const face1Pts: PxPt[] = [];
  const face2Pts: PxPt[] = [];
  let inFirst = true;
  for (let i = 0; i < poly.length; i++) {
    if (i === e1) { face1Pts.push(poly[i], m1); inFirst = false; face2Pts.push(m1); continue; }
    if (i === e2) { face2Pts.push(poly[i], m2); inFirst = true; face1Pts.push(m2); continue; }
    if (inFirst) face1Pts.push(poly[i]);
    else face2Pts.push(poly[i]);
  }

  if (face1Pts.length < 3 || face2Pts.length < 3) return null;

  const newFaces = [...original.faces];
  newFaces[faceIndex] = makeFace(face1Pts, priors, footprintPx);
  newFaces.push(makeFace(face2Pts, priors, footprintPx));

  const vertices = [...original.vertices, m1, m2];
  const edges = buildEdgesFromFaces(newFaces, footprintPx);
  return { ...original, vertices, faces: newFaces, edges, score: emptyScore() };
}

function cloneCandidateWithoutEdge(
  original: ConstraintCandidate, edgeIndex: number,
  priors: SolarTopologyPrior, footprintPx: PxPt[],
): ConstraintCandidate | null {
  // Remove the edge and merge the two adjacent faces
  const edge = original.edges[edgeIndex];
  const adjFaces = findAdjacentFaces(edge, original.faces);
  if (adjFaces.length !== 2) return null;

  // Merge: combine vertices of both faces, deduplicate
  const mergedPts = new Map<string, PxPt>();
  for (const f of adjFaces) {
    for (const p of f.polygon_px) {
      mergedPts.set(`${Math.round(p.x)},${Math.round(p.y)}`, p);
    }
  }
  const merged = Array.from(mergedPts.values());
  if (merged.length < 3) return null;

  // Sort by angle from centroid for convex hull approximation
  const c = polygonCentroid(merged);
  merged.sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));

  const newFaces = original.faces.filter(f => !adjFaces.includes(f));
  newFaces.push(makeFace(merged, priors, footprintPx));

  const edges = buildEdgesFromFaces(newFaces, footprintPx);
  return { ...original, faces: newFaces, edges, score: emptyScore() };
}

function cloneCandidateWithReclassifiedEdge(
  original: ConstraintCandidate, edgeIndex: number, newType: 'ridge' | 'hip' | 'valley',
  priors: SolarTopologyPrior, footprintPx: PxPt[],
): ConstraintCandidate {
  const edges = original.edges.map((e, i) =>
    i === edgeIndex ? { ...e, type: newType } : { ...e }
  );
  return { ...original, edges, score: emptyScore() };
}

// ═══════════════════════════════════════════════════
// EDGE CLASSIFICATION FROM ADJACENT NORMALS
// ═══════════════════════════════════════════════════

function classifyEdgesFromNormals(candidate: ConstraintCandidate): void {
  for (const edge of candidate.edges) {
    if (edge.type === 'eave' || edge.type === 'rake') continue;
    const adjFaces = findAdjacentFaces(edge, candidate.faces);
    if (adjFaces.length < 2) {
      if (adjFaces.length === 1) edge.type = 'hip';
      continue;
    }
    const az1 = adjFaces[0].azimuth_deg;
    const az2 = adjFaces[1].azimuth_deg;
    if (areOpposingAzimuths(az1, az2)) edge.type = 'ridge';
    else if (areConvergingAzimuths(az1, az2)) edge.type = 'valley';
    else edge.type = 'hip';
  }
}

// ═══════════════════════════════════════════════════
// AUTONOMOUS RESULT SCORING
// ═══════════════════════════════════════════════════

export function scoreAutonomousResult(
  faces: Array<{ polygon: [number, number][]; pitch_degrees: number; azimuth_degrees: number; plan_area_sqft: number; roof_area_sqft: number }>,
  edges: Array<{ type: string; length_ft: number }>,
  priors: SolarTopologyPrior,
  footprintAreaSqft: number,
): number {
  if (faces.length === 0) return 0;

  const totalArea = faces.reduce((s, f) => s + f.roof_area_sqft, 0);
  const areaTarget = priors.whole_roof_area_sqft || priors.total_pitched_area_sqft;

  const areaErrorPct = areaTarget > 0 ? Math.abs(totalArea - areaTarget) / areaTarget : 0.5;
  const areaScore = Math.max(0, 1 - areaErrorPct * 5);

  const avgPitch = faces.reduce((s, f) => s + f.pitch_degrees, 0) / faces.length;
  const pitchRise = pitchDegToRise(avgPitch);
  const pitchError = Math.abs(pitchRise - priors.dominant_pitch_rise);
  const pitchScore = Math.max(0, 1 - pitchError / 3);

  const facetDiff = Math.abs(faces.length - priors.expected_facet_count);
  const facetScore = Math.max(0, 1 - facetDiff / Math.max(priors.expected_facet_count, 4) * 2);

  const ridgeFt = edges.filter(e => e.type === 'ridge').reduce((s, e) => s + e.length_ft, 0);
  const ridgeScore = faces.length >= 4 && ridgeFt === 0 ? 0.2 : 1.0;

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

export function solveConstraintRoof(
  footprintPx: PxPt[],
  priors: SolarTopologyPrior,
  dsmEdges: DSMEdgeEvidence[],
  pxToSqft: number,
  autonomousScore: number,
): ConstraintSolverResult {
  const t0 = Date.now();

  if (!priors || priors.segments.length < 2) {
    return {
      used: false, best_candidate: null, candidates_evaluated: 0,
      autonomous_score: autonomousScore, constraint_score: 0,
      reason: 'insufficient_solar_priors',
      diagnostics: {
        pitch_locked: false, pitch_band: [0, 0], pitch_source: 'none',
        candidates_generated: 0, candidates_rejected: 0, optimization_iterations: 0,
        solar_segments_used: priors?.segments.length || 0, timing_ms: Date.now() - t0,
        candidate_scores: [], rejected_topologies: [], optimization_moves: [],
        constraint_error_breakdown: {},
      },
    };
  }

  // 1. Generate candidates
  const candidates = generateCandidates(footprintPx, priors, dsmEdges);
  console.log(`[CONSTRAINT_SOLVER_v2] Generated ${candidates.length} candidates from ${priors.segments.length} solar segments`);

  // 2. Score each candidate
  const rejectedTopologies: Array<{ id: string; type: string; reason: string }> = [];
  for (const cand of candidates) {
    cand.score = scoreCandidate(cand, priors, footprintPx, dsmEdges, pxToSqft);

    // Apply hard impossibility rules
    const impossibility = applyImpossibilityRules(cand, priors, footprintPx, pxToSqft);
    if (impossibility) {
      cand.rejected = true;
      cand.rejection_reason = impossibility;
      rejectedTopologies.push({ id: cand.id, type: cand.type, reason: impossibility });
      continue;
    }

    // Reject candidates with area error score < 0.2 (means >16% area mismatch)
    if (cand.score.area_error < 0.2) {
      cand.rejected = true;
      cand.rejection_reason = 'area_error_too_high';
      rejectedTopologies.push({ id: cand.id, type: cand.type, reason: 'area_error_too_high' });
    }
  }

  // 3. Sort valid candidates by score
  const validCandidates = candidates.filter(c => !c.rejected);
  validCandidates.sort((a, b) => b.score.total - a.score.total);

  if (validCandidates.length === 0) {
    return {
      used: false, best_candidate: null, candidates_evaluated: candidates.length,
      autonomous_score: autonomousScore, constraint_score: 0,
      reason: 'all_candidates_rejected',
      diagnostics: {
        pitch_locked: true, pitch_band: priors.pitch_band,
        pitch_source: 'google_solar_roofSegmentStats',
        candidates_generated: candidates.length,
        candidates_rejected: candidates.filter(c => c.rejected).length,
        optimization_iterations: 0, solar_segments_used: priors.segments.length,
        timing_ms: Date.now() - t0,
        candidate_scores: candidates.map(c => ({
          id: c.id, type: c.type, score: Number(c.score.total.toFixed(3)),
          rejected: c.rejected, rejection_reason: c.rejection_reason,
        })),
        rejected_topologies: rejectedTopologies,
        optimization_moves: [],
        constraint_error_breakdown: {},
      },
    };
  }

  // 4. Optimize the best candidate with expanded graph operations
  const best = validCandidates[0];
  const optimized = optimizeCandidate(best, priors, footprintPx, dsmEdges, pxToSqft);

  // 5. Classify edges from adjacent normals
  classifyEdgesFromNormals(optimized.candidate);

  // Re-score after optimization and classification
  optimized.candidate.score = scoreCandidate(optimized.candidate, priors, footprintPx, dsmEdges, pxToSqft);
  const constraintScore = optimized.candidate.score.total;

  // Final impossibility check after optimization
  const finalCheck = applyImpossibilityRules(optimized.candidate, priors, footprintPx, pxToSqft);
  if (finalCheck) {
    console.log(`[CONSTRAINT_SOLVER_v2] Post-optimization impossibility: ${finalCheck}`);
    optimized.candidate.rejected = true;
    optimized.candidate.rejection_reason = finalCheck;
  }

  console.log(`[CONSTRAINT_SOLVER_v2] Best: ${optimized.candidate.type} score=${constraintScore.toFixed(3)} vs autonomous=${autonomousScore.toFixed(3)} (${optimized.iterations} iters, ${optimized.moves.length} moves)`);

  const IMPROVEMENT_THRESHOLD = 0.10;
  const useConstraint = !optimized.candidate.rejected && constraintScore > autonomousScore + IMPROVEMENT_THRESHOLD;

  // Build constraint error breakdown
  const errorBreakdown: Record<string, number> = {};
  const s = optimized.candidate.score;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    errorBreakdown[key] = Number(((s as any)[key] * weight).toFixed(4));
  }

  return {
    used: useConstraint,
    best_candidate: optimized.candidate,
    candidates_evaluated: candidates.length,
    autonomous_score: autonomousScore,
    constraint_score: constraintScore,
    reason: useConstraint
      ? `constraint_solver_wins_${constraintScore.toFixed(3)}_vs_${autonomousScore.toFixed(3)}`
      : optimized.candidate.rejected
        ? `post_optimization_rejected: ${optimized.candidate.rejection_reason}`
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
        .map(c => ({
          id: c.id, type: c.type, score: Number(c.score.total.toFixed(3)),
          rejected: c.rejected, rejection_reason: c.rejection_reason,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8),
      rejected_topologies: rejectedTopologies,
      optimization_moves: optimized.moves,
      constraint_error_breakdown: errorBreakdown,
    },
  };
}
