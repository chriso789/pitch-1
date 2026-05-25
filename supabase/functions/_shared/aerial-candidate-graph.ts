// Registered Aerial Geometry Stage — builds a first-class diagnostic roof
// graph from already-registered aerial inputs (raster bounds + transform,
// Google Solar mask, target mask, perimeter ring, eave/rake edges) BEFORE
// any DSM topology solving runs.
//
// Contract:
//   • Pure function. No I/O, no throws on null inputs.
//   • Coordinate space: raster_px (NOT dsm_px).
//   • Every emitted edge is debug-only / not customer-ready.
//   • Skips cleanly (executed:false + skipped_reason) when essential inputs
//     are missing — never erases other diagnostics.
//   • Must not influence customer-report gating; aggregator filters apply.

export type AerialEdgeTypeCandidate =
  | "eave"
  | "rake"
  | "perimeter"
  | "unclassified";

export interface AerialNode {
  id: string;
  px: [number, number];
  geo: [number, number] | null;
  kind: "corner" | "reflex" | "convex";
}

export interface AerialEdge {
  id: string;
  type_candidate: AerialEdgeTypeCandidate;
  start_px: [number, number];
  end_px: [number, number];
  start_geo: [number, number] | null;
  end_geo: [number, number] | null;
  length_ft: number | null;
  confidence: number;
  evidence_source: string;
  debug_only: true;
  customer_ready: false;
  validation_status: "candidate_only";
}

export interface AerialCandidateFace {
  id: string;
  polygon_px: Array<[number, number]>;
  polygon_geo: Array<[number, number]> | null;
  source: "solar_segment" | "mask_component";
}

export interface AerialCandidateRoofGraph {
  version: "aerial-candidate-graph-v1";
  coordinate_space: "raster_px";
  executed: boolean;
  customer_ready: false;
  source: "registered_aerial_geometry";
  skipped_reason?: string;
  perimeter_ring_px: Array<[number, number]> | null;
  perimeter_ring_geo: Array<[number, number]> | null;
  perimeter_area_sqft: number | null;
  target_mask_area_sqft: number | null;
  perimeter_vs_mask_iou: number | null;
  target_mask_overlap_with_perimeter: number | null;
  nodes: AerialNode[];
  edges: AerialEdge[];
  candidate_faces: AerialCandidateFace[];
  evidence: {
    raster_registered: boolean;
    target_mask_isolation_checked: boolean;
    solar_segments_used: boolean;
    dsm_required: false;
  };
}

const MAX_NODES = 512;
const MAX_EDGES = 1024;
const MAX_FACES = 64;

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pxPair(raw: any): [number, number] | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const x = num(raw[0]);
    const y = num(raw[1]);
    if (x != null && y != null) return [x, y];
  }
  if (raw && typeof raw === "object") {
    const x = num((raw as any).x);
    const y = num((raw as any).y);
    if (x != null && y != null) return [x, y];
  }
  return null;
}

function geoPair(raw: any): [number, number] | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const a = num(raw[0]);
    const b = num(raw[1]);
    if (a != null && b != null) return [a, b];
  }
  if (raw && typeof raw === "object") {
    const lng = num((raw as any).lng ?? (raw as any).lon);
    const lat = num((raw as any).lat);
    if (lng != null && lat != null) return [lng, lat];
  }
  return null;
}

function normalizeRing(raw: any): Array<[number, number]> | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const out: Array<[number, number]> = [];
  for (const p of raw) {
    const pp = pxPair(p) ?? geoPair(p);
    if (pp) out.push(pp);
  }
  return out.length >= 3 ? out : null;
}

function normalizeGeoRing(raw: any): Array<[number, number]> | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const out: Array<[number, number]> = [];
  for (const p of raw) {
    const pp = geoPair(p);
    if (pp) out.push(pp);
  }
  return out.length >= 3 ? out : null;
}

// Haversine in feet between two [lng,lat] points.
function geoDistFt(
  a: [number, number] | null,
  b: [number, number] | null,
): number | null {
  if (!a || !b) return null;
  const R = 20902231; // earth radius ft
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const la1 = toRad(a[1]);
  const la2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function ringAreaSqft(ring: Array<[number, number]> | null): number | null {
  // Shoelace in geo space (approximate via local equirect projection).
  if (!ring || ring.length < 3) return null;
  let latSum = 0;
  for (const p of ring) latSum += p[1];
  const lat0 = latSum / ring.length;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ax = a[0] * mPerDegLng;
    const ay = a[1] * mPerDegLat;
    const bx = b[0] * mPerDegLng;
    const by = b[1] * mPerDegLat;
    acc += ax * by - bx * ay;
  }
  const m2 = Math.abs(acc) / 2;
  return m2 * 10.7639; // m² → ft²
}

export interface BuildAerialCandidateGraphArgs {
  rasterUrl?: string | null;
  rasterBoundsLatLng?: unknown;
  geoToRasterTransform?: unknown;
  perimeterTopology?: any;
  targetMaskIsolation?: any;
  solarSegments?: any;
  maskComponentsTable?: any;
  confirmedRoofCenterPx?: unknown;
  staticMapCenterLatLng?: unknown;
}

export function buildAerialCandidateGraph(
  args: BuildAerialCandidateGraphArgs,
): AerialCandidateRoofGraph {
  const base: AerialCandidateRoofGraph = {
    version: "aerial-candidate-graph-v1",
    coordinate_space: "raster_px",
    executed: false,
    customer_ready: false,
    source: "registered_aerial_geometry",
    perimeter_ring_px: null,
    perimeter_ring_geo: null,
    perimeter_area_sqft: null,
    target_mask_area_sqft: null,
    perimeter_vs_mask_iou: null,
    target_mask_overlap_with_perimeter: null,
    nodes: [],
    edges: [],
    candidate_faces: [],
    evidence: {
      raster_registered: false,
      target_mask_isolation_checked: false,
      solar_segments_used: false,
      dsm_required: false,
    },
  };

  const rasterRegistered = !!args.geoToRasterTransform &&
    !!args.rasterBoundsLatLng;
  base.evidence.raster_registered = rasterRegistered;

  const ringPx = normalizeRing(args.perimeterTopology?.perimeter_ring_px);
  const ringGeo = normalizeGeoRing(args.perimeterTopology?.perimeter_ring_geo);

  if (!rasterRegistered) {
    return { ...base, skipped_reason: "raster_transform_unavailable" };
  }
  if (!ringPx && !ringGeo) {
    return { ...base, skipped_reason: "perimeter_ring_unavailable" };
  }

  base.perimeter_ring_px = ringPx;
  base.perimeter_ring_geo = ringGeo;
  base.perimeter_area_sqft = ringAreaSqft(ringGeo);

  // Target mask diagnostics
  const tmi = args.targetMaskIsolation && typeof args.targetMaskIsolation === "object"
    ? args.targetMaskIsolation as Record<string, unknown>
    : null;
  if (tmi) {
    base.evidence.target_mask_isolation_checked = true;
    const tArea = num(
      (tmi as any).target_mask_area_sqft ??
        (tmi as any).chosen_component_area_sqft ??
        (tmi as any).area_sqft,
    );
    base.target_mask_area_sqft = tArea;
    base.perimeter_vs_mask_iou = num(
      args.perimeterTopology?.perimeter_vs_mask_iou ??
        (tmi as any).perimeter_vs_mask_iou,
    );
    base.target_mask_overlap_with_perimeter = num(
      args.perimeterTopology?.target_mask_overlap_with_perimeter ??
        (tmi as any).target_mask_overlap_with_perimeter,
    );
  }

  // Nodes from corner_nodes (or derived from ringPx as fallback)
  const cornerNodes = Array.isArray(args.perimeterTopology?.corner_nodes)
    ? args.perimeterTopology.corner_nodes
    : [];
  if (cornerNodes.length > 0) {
    for (let i = 0; i < cornerNodes.length && base.nodes.length < MAX_NODES; i++) {
      const n = cornerNodes[i];
      const px = pxPair(n?.px ?? n);
      if (!px) continue;
      const geo = geoPair(n?.geo) ?? null;
      const k = String(n?.kind ?? "").toLowerCase();
      const kind: AerialNode["kind"] =
        k === "reflex" ? "reflex" : k === "convex" ? "convex" : "corner";
      base.nodes.push({ id: `n_${i}`, px, geo, kind });
    }
  } else if (ringPx) {
    for (let i = 0; i < ringPx.length && base.nodes.length < MAX_NODES; i++) {
      base.nodes.push({
        id: `n_${i}`,
        px: ringPx[i],
        geo: ringGeo?.[i] ?? null,
        kind: "corner",
      });
    }
  }

  // Edges from eave_edges / rake_edges, falling back to perimeter ring segments
  const pushEdge = (
    raw: any,
    fallbackType: AerialEdgeTypeCandidate,
    source: string,
  ) => {
    if (base.edges.length >= MAX_EDGES) return;
    const startPx = pxPair(raw?.start_px ?? raw?.start ?? raw?.px?.[0]);
    const endPx = pxPair(raw?.end_px ?? raw?.end ?? raw?.px?.[1]);
    if (!startPx || !endPx) return;
    const startGeo = geoPair(raw?.start_geo ?? raw?.geo?.[0]);
    const endGeo = geoPair(raw?.end_geo ?? raw?.geo?.[1]);
    const lenFt = num(raw?.length_ft ?? raw?.length_lf) ??
      geoDistFt(startGeo, endGeo);
    const tRaw = String(raw?.type ?? raw?.type_candidate ?? "").toLowerCase();
    const type: AerialEdgeTypeCandidate =
      tRaw === "eave" || tRaw === "rake" || tRaw === "perimeter"
        ? tRaw
        : fallbackType;
    const conf = num(raw?.confidence);
    base.edges.push({
      id: `e_${base.edges.length}`,
      type_candidate: type,
      start_px: startPx,
      end_px: endPx,
      start_geo: startGeo,
      end_geo: endGeo,
      length_ft: lenFt,
      confidence: conf ?? 0.5,
      evidence_source: source,
      debug_only: true,
      customer_ready: false,
      validation_status: "candidate_only",
    });
  };

  const eaves = Array.isArray(args.perimeterTopology?.eave_edges)
    ? args.perimeterTopology.eave_edges
    : [];
  const rakes = Array.isArray(args.perimeterTopology?.rake_edges)
    ? args.perimeterTopology.rake_edges
    : [];
  for (const e of eaves) pushEdge(e, "eave", "perimeter_topology.eave_edges");
  for (const r of rakes) pushEdge(r, "rake", "perimeter_topology.rake_edges");

  if (base.edges.length === 0 && ringPx && ringPx.length >= 2) {
    for (let i = 0; i < ringPx.length; i++) {
      if (base.edges.length >= MAX_EDGES) break;
      const a = ringPx[i];
      const b = ringPx[(i + 1) % ringPx.length];
      const ga = ringGeo?.[i] ?? null;
      const gb = ringGeo?.[(i + 1) % (ringGeo?.length ?? 0)] ?? null;
      base.edges.push({
        id: `e_${i}`,
        type_candidate: "perimeter",
        start_px: a,
        end_px: b,
        start_geo: ga,
        end_geo: gb,
        length_ft: geoDistFt(ga, gb),
        confidence: 0.4,
        evidence_source: "perimeter_topology.perimeter_ring_px",
        debug_only: true,
        customer_ready: false,
        validation_status: "candidate_only",
      });
    }
  }

  // Candidate faces from solar segments / mask components
  const segments = Array.isArray(args.solarSegments)
    ? args.solarSegments
    : Array.isArray((args.solarSegments as any)?.segments)
    ? (args.solarSegments as any).segments
    : [];
  for (let i = 0; i < segments.length && base.candidate_faces.length < MAX_FACES; i++) {
    const s = segments[i];
    const polyPx = normalizeRing(s?.polygon_px ?? s?.polygon);
    const polyGeo = normalizeGeoRing(s?.polygon_geo ?? s?.boundary ?? s?.polygon);
    if (!polyPx && !polyGeo) continue;
    base.candidate_faces.push({
      id: `face_solar_${i}`,
      polygon_px: polyPx ?? [],
      polygon_geo: polyGeo,
      source: "solar_segment",
    });
  }
  if (segments.length > 0) base.evidence.solar_segments_used = true;

  const components = Array.isArray(args.maskComponentsTable)
    ? args.maskComponentsTable
    : Array.isArray((args.maskComponentsTable as any)?.components)
    ? (args.maskComponentsTable as any).components
    : [];
  for (
    let i = 0;
    i < components.length && base.candidate_faces.length < MAX_FACES;
    i++
  ) {
    const c = components[i];
    const polyPx = normalizeRing(c?.contour_px ?? c?.polygon_px);
    if (!polyPx) continue;
    base.candidate_faces.push({
      id: `face_mask_${i}`,
      polygon_px: polyPx,
      polygon_geo: normalizeGeoRing(c?.contour_geo ?? c?.polygon_geo),
      source: "mask_component",
    });
  }

  base.executed = true;
  return base;
}
