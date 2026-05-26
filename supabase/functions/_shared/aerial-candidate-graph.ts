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

export interface AerialCandidateGraphSkipDebug {
  has_perimeter_ring_px: boolean;
  perimeter_ring_px_source: string | null;
  has_perimeter_ring_geo: boolean;
  perimeter_ring_geo_source: string | null;
  has_geo_to_raster_transform: boolean;
  geo_to_raster_transform_source: string | null;
  has_raster_bounds_lat_lng: boolean;
  raster_bounds_source: string | null;
  has_overlay_raster_url: boolean;
  raster_registered_basis:
    | "transform"
    | "bounds_only"
    | "registration_package"
    | null;
  reason: string;
}

export interface AerialCandidateRoofGraph {
  version: "aerial-candidate-graph-v1";
  coordinate_space: "raster_px";
  executed: boolean;
  customer_ready: false;
  source: "registered_aerial_geometry";
  skipped_reason?: string;
  skip_debug?: AerialCandidateGraphSkipDebug;
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
    raster_registered_basis?:
      | "transform"
      | "bounds_only"
      | "registration_package"
      | null;
    target_mask_isolation_checked: boolean;
    solar_segments_used: boolean;
    dsm_required: false;
  };
  perimeter_source?: string | null;
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
  // New: fallback evidence sources persisted in geometry_report_json so the
  // builder can succeed even when the canonical perimeter_topology snapshot
  // has not been wired into a particular call site yet.
  registration?: any;
  overlayDebug?: any;
  debugLayers?: any;
  dsmPlanarGraphDebug?: any;
  debugRoofLines?: any;
}

function firstValid<T>(...candidates: Array<T | null | undefined>): T | null {
  for (const c of candidates) {
    if (c != null) return c as T;
  }
  return null;
}

function resolvePerimeterRingPx(
  args: BuildAerialCandidateGraphArgs,
): { ring: Array<[number, number]> | null; source: string | null } {
  const candidates: Array<[string, any]> = [
    [
      "perimeter_topology.perimeter_ring_px",
      args.perimeterTopology?.perimeter_ring_px,
    ],
    [
      "debug_layers.raw_perimeter_px",
      args.debugLayers?.raw_perimeter_px,
    ],
    [
      "debug_layers.selected_perimeter_px",
      args.debugLayers?.selected_perimeter_px,
    ],
    [
      "dsm_planar_graph_debug.perimeter_topology.perimeter_ring_px",
      args.dsmPlanarGraphDebug?.perimeter_topology?.perimeter_ring_px,
    ],
    [
      "dsm_planar_graph_debug.phase3_5.raw_perimeter_px",
      args.dsmPlanarGraphDebug?.phase3_5?.raw_perimeter_px,
    ],
    [
      "dsm_planar_graph_debug.debug_layers.raw_perimeter_px",
      args.dsmPlanarGraphDebug?.debug_layers?.raw_perimeter_px,
    ],
  ];
  for (const [src, raw] of candidates) {
    const ring = normalizeRing(raw);
    if (ring) return { ring, source: src };
  }
  return { ring: null, source: null };
}

function resolvePerimeterRingGeo(
  args: BuildAerialCandidateGraphArgs,
): { ring: Array<[number, number]> | null; source: string | null } {
  const candidates: Array<[string, any]> = [
    [
      "perimeter_topology.perimeter_ring_geo",
      args.perimeterTopology?.perimeter_ring_geo,
    ],
    [
      "dsm_planar_graph_debug.perimeter_topology.perimeter_ring_geo",
      args.dsmPlanarGraphDebug?.perimeter_topology?.perimeter_ring_geo,
    ],
  ];
  for (const [src, raw] of candidates) {
    const ring = normalizeGeoRing(raw);
    if (ring) return { ring, source: src };
  }
  // Derive from debugRoofLines[].geo only as last resort.
  if (Array.isArray(args.debugRoofLines)) {
    const flat: Array<[number, number]> = [];
    for (const dl of args.debugRoofLines) {
      const geo = Array.isArray(dl?.geo) ? dl.geo : null;
      if (!geo) continue;
      for (const p of geo) {
        const gp = geoPair(p);
        if (gp) flat.push(gp);
      }
    }
    if (flat.length >= 3) return { ring: flat, source: "debug_roof_lines[].geo" };
  }
  return { ring: null, source: null };
}

interface RegistrationResolution {
  registered: boolean;
  basis: "transform" | "bounds_only" | "registration_package" | null;
  geoToRasterTransform: any;
  geoToRasterTransformSource: string | null;
  rasterBoundsLatLng: any;
  rasterBoundsSource: string | null;
  rasterUrl: string | null;
  rasterUrlSource: string | null;
}

function resolveRasterRegistration(
  args: BuildAerialCandidateGraphArgs,
): RegistrationResolution {
  const pkg = args.registration?.transform_package ?? null;

  // geo→raster transform sources in priority order.
  const transformSources: Array<[string, any]> = [
    ["args.geoToRasterTransform", args.geoToRasterTransform],
    ["registration.transform_package.geo_to_raster_transform", pkg?.geo_to_raster_transform],
    ["registration.geo_to_raster_transform", args.registration?.geo_to_raster_transform],
  ];
  let transform: any = null;
  let transformSource: string | null = null;
  for (const [src, v] of transformSources) {
    if (v != null) { transform = v; transformSource = src; break; }
  }

  // raster bounds sources.
  const boundsSources: Array<[string, any]> = [
    ["args.rasterBoundsLatLng", args.rasterBoundsLatLng],
    ["registration.transform_package.raster_bounds_lat_lng", pkg?.raster_bounds_lat_lng],
    ["registration.raster_bounds_lat_lng", args.registration?.raster_bounds_lat_lng],
  ];
  let bounds: any = null;
  let boundsSource: string | null = null;
  for (const [src, v] of boundsSources) {
    if (v != null) { bounds = v; boundsSource = src; break; }
  }

  // raster url sources.
  const urlSources: Array<[string, any]> = [
    ["args.rasterUrl", args.rasterUrl],
    ["registration.raster.url", args.registration?.raster?.url],
  ];
  let rasterUrl: string | null = null;
  let rasterUrlSource: string | null = null;
  for (const [src, v] of urlSources) {
    if (v) { rasterUrl = String(v); rasterUrlSource = src; break; }
  }

  let basis: "transform" | "bounds_only" | "registration_package" | null = null;
  if (transform && bounds) basis = "transform";
  else if (transform) basis = "registration_package";
  else if (bounds && rasterUrl) basis = "bounds_only";

  return {
    registered: basis !== null,
    basis,
    geoToRasterTransform: transform,
    geoToRasterTransformSource: transformSource,
    rasterBoundsLatLng: bounds,
    rasterBoundsSource: boundsSource,
    rasterUrl,
    rasterUrlSource,
  };
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
      raster_registered_basis: null,
      target_mask_isolation_checked: false,
      solar_segments_used: false,
      dsm_required: false,
    },
    perimeter_source: null,
  };

  const reg = resolveRasterRegistration(args);
  base.evidence.raster_registered = reg.registered;
  base.evidence.raster_registered_basis = reg.basis;

  const { ring: ringPx, source: ringSource } = resolvePerimeterRingPx(args);
  const { ring: ringGeo, source: ringGeoSource } = resolvePerimeterRingGeo(args);
  base.perimeter_source = ringSource;

  const buildSkipDebug = (reason: string): AerialCandidateGraphSkipDebug => ({
    has_perimeter_ring_px: !!ringPx,
    perimeter_ring_px_source: ringSource,
    has_perimeter_ring_geo: !!ringGeo,
    perimeter_ring_geo_source: ringGeoSource,
    has_geo_to_raster_transform: !!reg.geoToRasterTransform,
    geo_to_raster_transform_source: reg.geoToRasterTransformSource,
    has_raster_bounds_lat_lng: !!reg.rasterBoundsLatLng,
    raster_bounds_source: reg.rasterBoundsSource,
    has_overlay_raster_url: !!reg.rasterUrl,
    raster_registered_basis: reg.basis,
    reason,
  });

  if (!reg.registered) {
    return {
      ...base,
      skipped_reason: "raster_transform_unavailable",
      skip_debug: buildSkipDebug("raster_transform_unavailable"),
    };
  }
  if (!ringPx && !ringGeo) {
    return {
      ...base,
      skipped_reason: "perimeter_ring_unavailable",
      skip_debug: buildSkipDebug("perimeter_ring_unavailable"),
    };
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
  const ringIndex = (i: unknown): [number, number] | null => {
    const idx = num(i);
    if (idx == null || !ringPx) return null;
    const k = ((idx % ringPx.length) + ringPx.length) % ringPx.length;
    return ringPx[k] ?? null;
  };

  const pushEdge = (
    raw: any,
    fallbackType: AerialEdgeTypeCandidate,
    source: string,
  ) => {
    if (base.edges.length >= MAX_EDGES) return;
    const startPx = pxPair(
      raw?.start_px ?? raw?.start ?? raw?.px?.[0] ?? raw?.a ?? raw?.p1 ??
        raw?.from,
    ) ?? ringIndex(raw?.start_index ?? raw?.from_index ?? raw?.i0);
    const endPx = pxPair(
      raw?.end_px ?? raw?.end ?? raw?.px?.[1] ?? raw?.b ?? raw?.p2 ?? raw?.to,
    ) ?? ringIndex(raw?.end_index ?? raw?.to_index ?? raw?.i1);
    if (!startPx || !endPx) return;
    const startGeo = geoPair(
      raw?.start_geo ?? raw?.geo?.[0] ?? raw?.a_geo ?? raw?.from_geo,
    );
    const endGeo = geoPair(
      raw?.end_geo ?? raw?.geo?.[1] ?? raw?.b_geo ?? raw?.to_geo,
    );
    const lenFt = num(raw?.length_ft ?? raw?.length_lf ?? raw?.length) ??
      geoDistFt(startGeo, endGeo);
    const tRaw = String(raw?.type ?? raw?.type_candidate ?? raw?.kind ?? "")
      .toLowerCase();
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
  const perimeterEdges = Array.isArray(args.perimeterTopology?.perimeter_edges)
    ? args.perimeterTopology.perimeter_edges
    : [];
  for (const e of eaves) pushEdge(e, "eave", "perimeter_topology.eave_edges");
  for (const r of rakes) pushEdge(r, "rake", "perimeter_topology.rake_edges");
  for (const pe of perimeterEdges) {
    pushEdge(pe, "perimeter", "perimeter_topology.perimeter_edges");
  }


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

  // Edge-construction guarantee: if we had perimeter evidence available
  // (eave/rake/perimeter_edges arrays OR a ring) but produced zero edges,
  // mark as skipped rather than reporting an executed but empty graph.
  if (base.edges.length === 0) {
    return {
      ...base,
      executed: false,
      skipped_reason: "edge_construction_failed",
      skip_debug: buildSkipDebug("edge_construction_failed"),
    };
  }

  base.executed = true;
  return base;
}

