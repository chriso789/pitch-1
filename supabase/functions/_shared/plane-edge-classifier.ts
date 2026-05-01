// Plane-tied edge classifier — TRUE TOPOLOGY VERSION.
// Builds shared-boundary adjacency via canonical edge map (vertex-snapped),
// then classifies edges as ridge/valley/hip/eave/rake from plane adjacency
// + slope direction.
//
// v2: Added proximity-based shared-boundary discovery for Solar segment gaps.
// Solar API segments often have 1-5px gaps between them, so exact edge
// matching finds 0 shared edges. This pass finds near-parallel close edges
// from different planes and promotes them to shared boundaries with full
// geometric validation — NOT fuzzy guessing.

export type Pt = { x: number; y: number };

export type PlaneIn = {
  id?: string | number;
  plane_index?: string | number;
  polygon_px: Pt[];
  pitch?: number | null;
  pitch_degrees?: number | null;
  azimuth?: number | null;
  azimuthDeg?: number | null;
  azimuth_degrees?: number | null;
};

export type RidgeHint = {
  id?: string;
  p1: Pt;
  p2: Pt;
  score?: number;
};

export type ClassifiedEdge = {
  id: string;
  edge_type: "ridge" | "valley" | "hip" | "eave" | "rake" | "unknown";
  line_px: Pt[];
  adjacent_plane_ids: string[];
  confidence: number;
  source: "plane_edge_classifier_v1" | "interior_fuzzy_shared_boundary";
  debug_reason: string;
};

// ── Grid snap: all vertices round to nearest GRID px ────────────────────
const GRID = 2;

function snap(v: Pt): Pt {
  return {
    x: Math.round(v.x / GRID) * GRID,
    y: Math.round(v.y / GRID) * GRID,
  };
}

function vtxKey(p: Pt): string {
  return `${p.x}:${p.y}`;
}

/** Canonical edge key — sorted endpoints so A→B === B→A */
function canonEdgeKey(a: Pt, b: Pt): string {
  const ka = vtxKey(a);
  const kb = vtxKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function pid(p: PlaneIn, i: number): string {
  return String(p.id ?? p.plane_index ?? i);
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function norm(v: Pt): Pt {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y }; }
function dot(a: Pt, b: Pt): number { return a.x * b.x + a.y * b.y; }

function centroid(poly: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of poly || []) { x += p.x; y += p.y; }
  const n = Math.max(1, poly?.length || 0);
  return { x: x / n, y: y / n };
}

function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function angleDeg(a: Pt, b: Pt): number {
  const deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  return ((deg % 180) + 180) % 180;
}

function angleDiff180(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

function azDeg(p: PlaneIn): number | null {
  const v = p.azimuthDeg ?? p.azimuth_degrees ?? p.azimuth;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(ap, ab) / Math.max(dot(ab, ab), 1e-9)));
  const q = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return dist(p, q);
}

/** Project point onto line segment, return projected point */
function projectOntoSegment(p: Pt, a: Pt, b: Pt): Pt {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(ap, ab) / Math.max(dot(ab, ab), 1e-9)));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

/** Compute the overlap length of two collinear segments projected onto a shared axis */
function collinearOverlap(a1: Pt, a2: Pt, b1: Pt, b2: Pt): number {
  const dir = norm(sub(a2, a1));
  const projA1 = dot(a1, dir);
  const projA2 = dot(a2, dir);
  const projB1 = dot(b1, dir);
  const projB2 = dot(b2, dir);
  const aMin = Math.min(projA1, projA2);
  const aMax = Math.max(projA1, projA2);
  const bMin = Math.min(projB1, projB2);
  const bMax = Math.max(projB1, projB2);
  const overlapStart = Math.max(aMin, bMin);
  const overlapEnd = Math.min(aMax, bMax);
  return Math.max(0, overlapEnd - overlapStart);
}

// ── Step 1: Snap all plane vertices to grid ─────────────────────────────
function snapPolygon(poly: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of poly) {
    const s = snap(p);
    // dedupe consecutive
    if (out.length > 0 && vtxKey(out[out.length - 1]) === vtxKey(s)) continue;
    out.push(s);
  }
  // close-loop dedupe
  if (out.length > 1 && vtxKey(out[0]) === vtxKey(out[out.length - 1])) out.pop();
  return out;
}

// ── Step 2+3: Build canonical edge map across all planes ────────────────
interface EdgeEntry {
  key: string;
  a: Pt;
  b: Pt;
  planeIds: Set<string>;
}

function buildEdgeMap(planes: { planeId: string; poly: Pt[] }[]): Map<string, EdgeEntry> {
  const map = new Map<string, EdgeEntry>();

  for (const { planeId, poly } of planes) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (vtxKey(a) === vtxKey(b)) continue; // zero-length edge

      const key = canonEdgeKey(a, b);
      let entry = map.get(key);
      if (!entry) {
        entry = { key, a, b, planeIds: new Set() };
        map.set(key, entry);
      }
      entry.planeIds.add(planeId);
    }
  }

  return map;
}

// ── Proximity shared-boundary discovery ─────────────────────────────────
// Google Solar segments often have 1-5px gaps between adjacent planes.
// This finds exterior edges from different planes that are:
//   - near-parallel (angle < 12°)
//   - close (perpendicular distance < GAP_TOLERANCE px)
//   - significantly overlapping (>50% of shorter edge)
// and promotes them to shared boundaries by computing the merged midline.

const GAP_TOLERANCE = 8; // max gap between adjacent Solar segments in px
const MIN_OVERLAP_RATIO = 0.4; // minimum overlap as fraction of shorter edge
const MAX_ANGLE_DIFF = 12; // degrees

interface ProximityMatch {
  edgeA: EdgeEntry;
  edgeB: EdgeEntry;
  planeIdA: string;
  planeIdB: string;
  midlineP1: Pt;
  midlineP2: Pt;
  overlapLength: number;
  gapDistance: number;
}

function findProximitySharedBoundaries(
  edgeMap: Map<string, EdgeEntry>,
  planeById: Map<string, { planeId: string; poly: Pt[]; original: PlaneIn }>,
): ProximityMatch[] {
  // Collect all exterior (single-plane) edges
  const exteriors: { entry: EdgeEntry; planeId: string; angle: number; length: number }[] = [];
  for (const entry of edgeMap.values()) {
    const ids = Array.from(entry.planeIds);
    if (ids.length !== 1) continue;
    const len = dist(entry.a, entry.b);
    if (len < 6) continue; // skip tiny edges
    exteriors.push({
      entry,
      planeId: ids[0],
      angle: angleDeg(entry.a, entry.b),
      length: len,
    });
  }

  const matches: ProximityMatch[] = [];
  const usedKeys = new Set<string>();

  for (let i = 0; i < exteriors.length; i++) {
    const ea = exteriors[i];
    if (usedKeys.has(ea.entry.key)) continue;

    let bestMatch: { j: number; gap: number; overlap: number; midP1: Pt; midP2: Pt } | null = null;

    for (let j = i + 1; j < exteriors.length; j++) {
      const eb = exteriors[j];
      if (usedKeys.has(eb.entry.key)) continue;
      if (ea.planeId === eb.planeId) continue; // same plane

      // Angle check
      if (angleDiff180(ea.angle, eb.angle) > MAX_ANGLE_DIFF) continue;

      // Perpendicular distance check — both endpoints of each edge to the other
      const dA1 = pointToSegmentDistance(ea.entry.a, eb.entry.a, eb.entry.b);
      const dA2 = pointToSegmentDistance(ea.entry.b, eb.entry.a, eb.entry.b);
      const dB1 = pointToSegmentDistance(eb.entry.a, ea.entry.a, ea.entry.b);
      const dB2 = pointToSegmentDistance(eb.entry.b, ea.entry.a, ea.entry.b);
      const maxGap = Math.max(Math.min(dA1, dA2), Math.min(dB1, dB2));
      if (maxGap > GAP_TOLERANCE) continue;

      // Overlap check
      const overlap = collinearOverlap(ea.entry.a, ea.entry.b, eb.entry.a, eb.entry.b);
      const shorter = Math.min(ea.length, eb.length);
      if (overlap < shorter * MIN_OVERLAP_RATIO) continue;

      const avgGap = (dA1 + dA2 + dB1 + dB2) / 4;
      if (!bestMatch || avgGap < bestMatch.gap) {
        // Compute midline of the overlapping portion
        const projA1 = projectOntoSegment(ea.entry.a, eb.entry.a, eb.entry.b);
        const projA2 = projectOntoSegment(ea.entry.b, eb.entry.a, eb.entry.b);
        const projB1 = projectOntoSegment(eb.entry.a, ea.entry.a, ea.entry.b);
        const projB2 = projectOntoSegment(eb.entry.b, ea.entry.a, ea.entry.b);

        // Use the tighter pair of projections for the midline
        const midP1 = midpoint(ea.entry.a, projA1);
        const midP2 = midpoint(ea.entry.b, projA2);

        bestMatch = { j, gap: avgGap, overlap, midP1: snap(midP1), midP2: snap(midP2) };
      }
    }

    if (bestMatch) {
      const eb = exteriors[bestMatch.j];
      usedKeys.add(ea.entry.key);
      usedKeys.add(eb.entry.key);

      matches.push({
        edgeA: ea.entry,
        edgeB: eb.entry,
        planeIdA: ea.planeId,
        planeIdB: eb.planeId,
        midlineP1: bestMatch.midP1,
        midlineP2: bestMatch.midP2,
        overlapLength: bestMatch.overlap,
        gapDistance: bestMatch.gap,
      });
    }
  }

  return matches;
}

// ── Edge classification — PHYSICS-BASED ─────────────────────────────────
// Uses slope (downhill) vectors derived from plane azimuth + edge normal
// to determine ridge/hip/valley by actual water-flow physics.

/** Slope vector: direction of steepest descent (water flow) */
function slopeVector(azimuthDeg: number): Pt {
  const rad = azimuthDeg * Math.PI / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

/** Edge normal: perpendicular to edge direction */
function edgeNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

function classifySharedBoundary(args: {
  a: PlaneIn;
  b: PlaneIn;
  aId: string;
  bId: string;
  segment: [Pt, Pt];
  ridgeHints: RidgeHint[];
  edgeIndex: number;
}): ClassifiedEdge {
  const { a, b, aId, bId, segment, ridgeHints, edgeIndex } = args;
  const [p1, p2] = segment;

  const azA = azDeg(a);
  const azB = azDeg(b);
  const boundaryAngle = angleDeg(p1, p2);

  const alignedHint = ridgeHints.find((r) => {
    const hintAngle = angleDeg(r.p1, r.p2);
    const angleOk = angleDiff180(boundaryAngle, hintAngle) <= 15;
    const d1 = pointToSegmentDistance(p1, r.p1, r.p2);
    const d2 = pointToSegmentDistance(p2, r.p1, r.p2);
    return angleOk && Math.max(d1, d2) <= 18;
  });

  if (azA !== null && azB !== null) {
    const s1 = slopeVector(azA);
    const s2 = slopeVector(azB);
    const n = edgeNormal(p1, p2);

    const f1 = dot(s1, n);
    const f2 = dot(s2, n);

    const T = 0.15; // flow threshold
    const confidence_base = Math.min(Math.abs(f1), Math.abs(f2));

    const away1 = f1 > T;
    const away2 = f2 > T;
    const toward1 = f1 < -T;
    const toward2 = f2 < -T;
    const parallel1 = Math.abs(f1) <= T;
    const parallel2 = Math.abs(f2) <= T;

    // Both slopes flow AWAY from the edge → RIDGE
    if (away1 && away2) {
      return {
        id: `E${edgeIndex}`, edge_type: "ridge", line_px: [p1, p2],
        adjacent_plane_ids: [aId, bId],
        confidence: Math.max(0.80, Math.min(0.97, 0.80 + confidence_base * 0.2)),
        source: "plane_edge_classifier_v1",
        debug_reason: `physics: both slopes away from edge (f1=${f1.toFixed(3)}, f2=${f2.toFixed(3)})`,
      };
    }

    // Both slopes flow TOWARD the edge → VALLEY
    if (toward1 && toward2) {
      return {
        id: `E${edgeIndex}`, edge_type: "valley", line_px: [p1, p2],
        adjacent_plane_ids: [aId, bId],
        confidence: Math.max(0.80, Math.min(0.95, 0.80 + confidence_base * 0.2)),
        source: "plane_edge_classifier_v1",
        debug_reason: `physics: both slopes toward edge (f1=${f1.toFixed(3)}, f2=${f2.toFixed(3)})`,
      };
    }

    // One away, one toward → HIP
    if ((away1 && toward2) || (toward1 && away2)) {
      return {
        id: `E${edgeIndex}`, edge_type: "hip", line_px: [p1, p2],
        adjacent_plane_ids: [aId, bId],
        confidence: Math.max(0.75, Math.min(0.90, 0.75 + confidence_base * 0.2)),
        source: "plane_edge_classifier_v1",
        debug_reason: `physics: opposing flow across edge (f1=${f1.toFixed(3)}, f2=${f2.toFixed(3)})`,
      };
    }

    // Both parallel to edge → not structural
    if (parallel1 && parallel2) {
      return {
        id: `E${edgeIndex}`, edge_type: "unknown", line_px: [p1, p2],
        adjacent_plane_ids: [aId, bId], confidence: 0.30,
        source: "plane_edge_classifier_v1",
        debug_reason: `physics: both slopes parallel to edge — likely non-structural (f1=${f1.toFixed(3)}, f2=${f2.toFixed(3)})`,
      };
    }

    // Mixed (one parallel, one directional) → hip fallback
    return {
      id: `E${edgeIndex}`, edge_type: "hip", line_px: [p1, p2],
      adjacent_plane_ids: [aId, bId],
      confidence: Math.max(0.55, Math.min(0.72, 0.55 + confidence_base * 0.2)),
      source: "plane_edge_classifier_v1",
      debug_reason: `physics: mixed flow (f1=${f1.toFixed(3)}, f2=${f2.toFixed(3)}) — hip fallback`,
    };
  }

  // No azimuth data — fallback to hint or unknown
  return {
    id: `E${edgeIndex}`,
    edge_type: alignedHint ? "ridge" : "unknown",
    line_px: [p1, p2],
    adjacent_plane_ids: [aId, bId],
    confidence: alignedHint ? 0.55 : 0.35,
    source: "plane_edge_classifier_v1",
    debug_reason: alignedHint
      ? "no azimuth — ridge hint aligned with shared edge"
      : "no azimuth — cannot determine edge type",
  };
}

function classifyExteriorEdge(args: {
  plane: PlaneIn;
  planeId: string;
  edge: [Pt, Pt];
  edgeIndex: number;
}): ClassifiedEdge {
  const { plane, planeId, edge, edgeIndex } = args;
  const [p1, p2] = edge;
  const az = azDeg(plane);
  const eAngle = angleDeg(p1, p2);

  let edgeType: "eave" | "rake" = "eave";
  let reason = "default exterior edge";

  if (az !== null) {
    const downslopeAxis = ((az % 180) + 180) % 180;
    const d = angleDiff180(eAngle, downslopeAxis);
    if (d <= 30) {
      edgeType = "rake";
      reason = "exterior edge parallel to downslope axis";
    } else {
      edgeType = "eave";
      reason = "exterior edge perpendicular to downslope axis";
    }
  }

  return {
    id: `E${edgeIndex}`, edge_type: edgeType, line_px: [p1, p2],
    adjacent_plane_ids: [planeId], confidence: az !== null ? 0.78 : 0.55,
    source: "plane_edge_classifier_v1", debug_reason: reason,
  };
}

// ── Main entry ──────────────────────────────────────────────────────────

export function classifyPlaneEdges(args: {
  planes: PlaneIn[];
  ridgeHints?: RidgeHint[];
}) {
  const planes = args.planes || [];
  const ridgeHints = args.ridgeHints || [];

  // ── 1. Snap every plane polygon to the grid ───────────────────────
  const snappedPlanes = planes.map((p, i) => ({
    planeId: pid(p, i),
    poly: snapPolygon(p.polygon_px || []),
    original: p,
  }));

  // ── 2. Build global canonical edge map ────────────────────────────
  const edgeMap = buildEdgeMap(snappedPlanes);

  let edgeIndex = 0;
  const sharedEdges: ClassifiedEdge[] = [];
  const exteriorEdges: ClassifiedEdge[] = [];
  let invalidEdges = 0;

  const planeById = new Map(snappedPlanes.map((sp) => [sp.planeId, sp]));

  // ── 3. Classify each edge from exact canonical map ────────────────
  const exactSharedKeys = new Set<string>();
  for (const entry of edgeMap.values()) {
    const segLen = dist(entry.a, entry.b);
    if (segLen < 4) continue; // skip tiny edges

    const planeIds = Array.from(entry.planeIds);

    if (planeIds.length === 2) {
      exactSharedKeys.add(entry.key);
      // SHARED BOUNDARY — classify as ridge/hip/valley
      const spA = planeById.get(planeIds[0])!;
      const spB = planeById.get(planeIds[1])!;
      sharedEdges.push(
        classifySharedBoundary({
          a: spA.original,
          b: spB.original,
          aId: planeIds[0],
          bId: planeIds[1],
          segment: [entry.a, entry.b],
          ridgeHints,
          edgeIndex: edgeIndex++,
        }),
      );
    } else if (planeIds.length === 1) {
      // Will classify as exterior below (after proximity pass)
    } else {
      // >2 planes sharing one edge = invalid topology
      invalidEdges++;
    }
  }

  // ── 3b. Proximity-based shared boundary discovery ─────────────────
  // When exact canonical matching finds few shared edges (common with
  // Google Solar rasterized segments that have 1-5px gaps), discover
  // near-parallel close exterior edges from different planes and promote
  // them only as fuzzy candidates. They are useful for diagnostics/preview,
  // but MUST NOT count toward ridge/hip/valley totals downstream.
  const proximityMatches = findProximitySharedBoundaries(edgeMap, planeById);
  const proximityConsumedKeys = new Set<string>();

  for (const pm of proximityMatches) {
    const spA = planeById.get(pm.planeIdA);
    const spB = planeById.get(pm.planeIdB);
    if (!spA || !spB) continue;

    // Skip if midline is degenerate
    if (dist(pm.midlineP1, pm.midlineP2) < 4) continue;

    const fuzzyCandidate = classifySharedBoundary({
        a: spA.original,
        b: spB.original,
        aId: pm.planeIdA,
        bId: pm.planeIdB,
        segment: [pm.midlineP1, pm.midlineP2],
        ridgeHints,
        edgeIndex: edgeIndex++,
      });

    sharedEdges.push({
      ...fuzzyCandidate,
      source: "interior_fuzzy_shared_boundary",
      confidence: Math.min(fuzzyCandidate.confidence, 0.42),
      debug_reason: `proximity/fuzzy candidate only: gap_px=${Math.round(pm.gapDistance * 10) / 10}, overlap_px=${Math.round(pm.overlapLength)}; ${fuzzyCandidate.debug_reason}`,
    });

    proximityConsumedKeys.add(pm.edgeA.key);
    proximityConsumedKeys.add(pm.edgeB.key);
  }

  // ── 3c. Classify remaining exterior edges ─────────────────────────
  for (const entry of edgeMap.values()) {
    const segLen = dist(entry.a, entry.b);
    if (segLen < 4) continue;
    const planeIds = Array.from(entry.planeIds);
    if (planeIds.length !== 1) continue;
    if (exactSharedKeys.has(entry.key)) continue;
    if (proximityConsumedKeys.has(entry.key)) continue; // consumed by proximity match

    const sp = planeById.get(planeIds[0])!;
    exteriorEdges.push(
      classifyExteriorEdge({
        plane: sp.original,
        planeId: planeIds[0],
        edge: [entry.a, entry.b],
        edgeIndex: edgeIndex++,
      }),
    );
  }

  // Combine and dedupe
  const all = [...sharedEdges, ...exteriorEdges];

  // Reject any ridge not bounded by exactly 2 planes
  const validated = all.filter(
    (e) => !(e.edge_type === "ridge" && e.adjacent_plane_ids.length !== 2),
  );

  // Dedupe by rounded endpoint + type + planes
  const seen = new Set<string>();
  const deduped: ClassifiedEdge[] = [];
  for (const e of validated) {
    const a = e.line_px[0];
    const b = e.line_px[e.line_px.length - 1];
    const pts = [
      `${Math.round(a.x)}:${Math.round(a.y)}`,
      `${Math.round(b.x)}:${Math.round(b.y)}`,
    ].sort();
    const key = `${e.edge_type}:${pts[0]}-${pts[1]}:${e.adjacent_plane_ids.slice().sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }

  const counts = deduped.reduce((acc: Record<string, number>, e) => {
    acc[e.edge_type] = (acc[e.edge_type] || 0) + 1;
    return acc;
  }, {});

  const invalidRidgeHints = ridgeHints.filter((r) => {
    const hintAngle = angleDeg(r.p1, r.p2);
    return !sharedEdges.some((e) => {
      const eAngle = angleDeg(e.line_px[0], e.line_px[e.line_px.length - 1]);
      const angleOk = angleDiff180(hintAngle, eAngle) <= 12;
      const d1 = pointToSegmentDistance(r.p1, e.line_px[0], e.line_px[e.line_px.length - 1]);
      const d2 = pointToSegmentDistance(r.p2, e.line_px[0], e.line_px[e.line_px.length - 1]);
      return angleOk && Math.max(d1, d2) <= 18;
    });
  });

  console.log("[PLANE_EDGE_CLASSIFIER]", JSON.stringify({
    planes: planes.length,
    total_edges_in_map: edgeMap.size,
    exact_shared_edges: exactSharedKeys.size,
    proximity_shared_edges: proximityMatches.length,
    shared_edges: sharedEdges.length,
    exterior_edges: exteriorEdges.length,
    invalid_edges: invalidEdges,
    final_edges: deduped.length,
    counts,
    ridge_hints: ridgeHints.length,
    invalid_ridge_hints: invalidRidgeHints.length,
    proximity_details: proximityMatches.map((m) => ({
      planeA: m.planeIdA,
      planeB: m.planeIdB,
      gap_px: Math.round(m.gapDistance * 10) / 10,
      overlap_px: Math.round(m.overlapLength),
    })),
  }));

  return {
    edges: deduped,
    debug: {
      plane_count: planes.length,
      edge_count: deduped.length,
      total_edges_in_map: edgeMap.size,
      exact_shared_edges: exactSharedKeys.size,
      proximity_shared_edges: proximityMatches.length,
      shared_edges: sharedEdges.length,
      exterior_edges: exteriorEdges.length,
      invalid_edges: invalidEdges,
      counts,
      ridge_hints_total: ridgeHints.length,
      invalid_ridge_hints_count: invalidRidgeHints.length,
      invalid_ridge_hints: invalidRidgeHints.map((r) => ({
        id: r.id, score: r.score, p1: r.p1, p2: r.p2,
      })),
    },
  };
}
