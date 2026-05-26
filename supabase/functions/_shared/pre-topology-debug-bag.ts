// Pre-Topology Debug Bag — slice 2 (edge-function backend)
//
// Pure helpers used by `start-ai-measurement` so that whenever the pipeline
// preempts or fails BEFORE topology runs, the persisted row still carries the
// cheap evidence layers (perimeter Phase 0 snapshot, perimeter topology
// snapshot, target mask isolation, footprint, DSM/mask/raster split status,
// and a `debug_roof_lines` array typed as debug-only / not-customer-ready).
//
// These helpers are pure — they do not touch supabase, do not throw on null
// inputs, and do not mutate their inputs (except the explicit safety-gate
// helper, which mutates the in-place payload it is given).

import {
  type AerialCandidateRoofGraph,
  buildAerialCandidateGraph,
} from "./aerial-candidate-graph.ts";



export type PreTopologyStage =
  | "pre_phase3_5_preempt"
  | "phase3_5_perimeter_refinement"
  | "autonomous_topology_solver";

export interface DebugRoofLine {
  type: "eave" | "rake" | "perimeter" | "unknown";
  geo: Array<[number, number]> | null;
  px: Array<[number, number]> | null;
  length_ft?: number | null;
  debug_only: true;
  customer_ready: false;
  candidate_source: "phase3A";
  validation_status: "candidate_only";
  reason_not_reportable: "runtime_preempted_before_validated_topology";
}

export interface DsmSplitStatusFetchDecode {
  status: "pass" | "fail";
  stage: "dsm_fetch_decode";
  dsm_loaded: boolean;
  mask_loaded: boolean;
  raster_loaded: boolean;
  dsm_size_px: { width: number; height: number } | null;
}

export interface DsmSplitStatusGeoreg {
  status: "pass" | "fail" | "warning";
  stage: "dsm_georeg_transform";
  dsm_tile_bounds_lat_lng_present: boolean;
  geo_to_dsm_transform_present: boolean;
  dsm_to_raster_transform_present: boolean;
  dsm_pixel_transform_valid: boolean;
}

export interface DsmSplitStatus {
  // Flat (legacy) fields preserved for backwards compatibility.
  dsm_loaded: boolean;
  masked_dsm_loaded: boolean;
  mask_loaded: boolean;
  raster_loaded: boolean;
  dsm_size_px: { width: number; height: number } | null;
  masked_dsm_size_px: { width: number; height: number } | null;
  raster_size_px: { width: number; height: number } | null;
  dsm_resolution_mpp: number | null;
  // Nested contract added in slice 3.
  fetch_decode: DsmSplitStatusFetchDecode;
  georegistration_transform: DsmSplitStatusGeoreg;
}

export interface PreTopologyDebugBag {
  dsm_split_status: DsmSplitStatus;
  perimeter_phase0: any;
  perimeter_topology: any;
  target_mask_isolation: any;
  footprint_source: string | null;
  footprint_valid: boolean;
  footprint_point_count: number;
  footprint_px: Array<[number, number]> | null;
  debug_roof_lines: DebugRoofLine[];
  debug_layers_persisted_at_stage: PreTopologyStage;
  dsm_loaded: boolean;
  mask_loaded: boolean;
  raster_loaded: boolean;
  raw_perimeter_px: Array<[number, number]> | null;
  aerial_candidate_roof_graph: AerialCandidateRoofGraph | null;
  primary_geometry_source?: "aerial_registered" | null;
  dsm_validation_status?: { available: boolean; reason: string | null } | null;
  /**
   * Snapshot of the registration object passed into the aerial graph builder
   * at bag-build time. Persisting it lets downstream consumers
   * (e.g. `buildCpuBudgetTerminalDebugPayload` and the final-payload
   * rebuild) detect when transform inputs are present even though the graph
   * skipped — and rebuild instead of leaving a stale skip in place.
   */
  registration?: any;
}


const MAX_DEBUG_ROOF_LINES = 512;
const MAX_FOOTPRINT_PX_POINTS = 256;

function sizeOf(
  grid: any,
): { width: number; height: number } | null {
  if (!grid) return null;
  const w = Number(grid?.width);
  const h = Number(grid?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return { width: w, height: h };
}

function buildDsmSplitStatus(args: {
  dsmGrid: any;
  maskedDSM: any;
  roofMask: any;
  raster: any;
  registration?: any;
}): DsmSplitStatus {
  const dsmSize = sizeOf(args.dsmGrid);
  const maskedDsmSize = sizeOf(args.maskedDSM);
  const rasterSize = sizeOf(args.raster);
  const dsmRes = Number(args.dsmGrid?.resolution ?? args.maskedDSM?.resolution);
  const dsmLoaded = !!args.dsmGrid;
  const maskLoaded = !!args.roofMask;
  const rasterLoaded = !!args.raster &&
    !!(args.raster as any)?.width && !!(args.raster as any)?.height;
  const reg = args.registration ?? {};
  const tileBoundsPresent = reg?.dsm_tile_bounds_lat_lng != null;
  const geoToDsmPresent = reg?.geo_to_dsm_transform != null ||
    reg?.geo_to_dsm_px_success === true;
  const dsmToRasterPresent = reg?.dsm_to_raster_transform != null;
  const dsmPixelTransformValid = reg?.dsm_pixel_transform_valid === true;
  const hasAllTransforms = tileBoundsPresent && geoToDsmPresent &&
    dsmToRasterPresent && dsmPixelTransformValid;
  return {
    dsm_loaded: dsmLoaded,
    masked_dsm_loaded: !!args.maskedDSM,
    mask_loaded: maskLoaded,
    raster_loaded: rasterLoaded,
    dsm_size_px: dsmSize,
    masked_dsm_size_px: maskedDsmSize,
    raster_size_px: rasterSize,
    dsm_resolution_mpp: Number.isFinite(dsmRes) && dsmRes > 0 ? dsmRes : null,
    fetch_decode: {
      status: dsmLoaded && maskLoaded && rasterLoaded ? "pass" : "fail",
      stage: "dsm_fetch_decode",
      dsm_loaded: dsmLoaded,
      mask_loaded: maskLoaded,
      raster_loaded: rasterLoaded,
      dsm_size_px: dsmSize,
    },
    georegistration_transform: {
      status: hasAllTransforms ? "pass" : (dsmLoaded ? "fail" : "warning"),
      stage: "dsm_georeg_transform",
      dsm_tile_bounds_lat_lng_present: tileBoundsPresent,
      geo_to_dsm_transform_present: geoToDsmPresent,
      dsm_to_raster_transform_present: dsmToRasterPresent,
      dsm_pixel_transform_valid: dsmPixelTransformValid,
    },
  };
}

function classifyDebugLineType(raw: any): DebugRoofLine["type"] {
  const t = String(raw?.type ?? raw?.kind ?? "").toLowerCase();
  if (t === "eave") return "eave";
  if (t === "rake") return "rake";
  if (t === "perimeter") return "perimeter";
  return "unknown";
}

function pickGeoPair(raw: any): Array<[number, number]> | null {
  // Accept multiple shapes: { geo: [[lng,lat],[lng,lat]] } or
  // { start: {lng,lat}, end: {lng,lat} } or { a: [lng,lat], b: [lng,lat] }.
  if (Array.isArray(raw?.geo) && raw.geo.length >= 2) {
    const a = raw.geo[0];
    const b = raw.geo[1];
    if (Array.isArray(a) && Array.isArray(b)) {
      return [
        [Number(a[0]), Number(a[1])],
        [Number(b[0]), Number(b[1])],
      ];
    }
  }
  if (raw?.start && raw?.end) {
    const sa = raw.start;
    const ea = raw.end;
    const sLng = Number(sa?.lng ?? sa?.lon ?? sa?.x);
    const sLat = Number(sa?.lat ?? sa?.y);
    const eLng = Number(ea?.lng ?? ea?.lon ?? ea?.x);
    const eLat = Number(ea?.lat ?? ea?.y);
    if ([sLng, sLat, eLng, eLat].every(Number.isFinite)) {
      return [[sLng, sLat], [eLng, eLat]];
    }
  }
  return null;
}

function pickPxPair(raw: any): Array<[number, number]> | null {
  if (Array.isArray(raw?.px) && raw.px.length >= 2) {
    const a = raw.px[0];
    const b = raw.px[1];
    if (Array.isArray(a) && Array.isArray(b)) {
      return [
        [Number(a[0]), Number(a[1])],
        [Number(b[0]), Number(b[1])],
      ];
    }
  }
  if (Array.isArray(raw?.start_px) && Array.isArray(raw?.end_px)) {
    return [
      [Number(raw.start_px[0]), Number(raw.start_px[1])],
      [Number(raw.end_px[0]), Number(raw.end_px[1])],
    ];
  }
  return null;
}

export function buildDebugRoofLines(perimeterTopology: any): DebugRoofLine[] {
  if (!perimeterTopology) return [];
  const eaves = Array.isArray(perimeterTopology?.eave_edges)
    ? perimeterTopology.eave_edges
    : [];
  const rakes = Array.isArray(perimeterTopology?.rake_edges)
    ? perimeterTopology.rake_edges
    : [];
  const ring = Array.isArray(perimeterTopology?.perimeter_ring_geo)
    ? perimeterTopology.perimeter_ring_geo
    : null;
  const out: DebugRoofLine[] = [];

  const pushEdge = (raw: any, fallbackType: DebugRoofLine["type"]) => {
    if (out.length >= MAX_DEBUG_ROOF_LINES) return;
    const geo = pickGeoPair(raw);
    const px = pickPxPair(raw);
    if (!geo && !px) return;
    const type = classifyDebugLineType(raw) === "unknown"
      ? fallbackType
      : classifyDebugLineType(raw);
    const lenRaw = Number(raw?.length_ft ?? raw?.length_lf);
    const length_ft = Number.isFinite(lenRaw) && lenRaw > 0 ? lenRaw : null;
    out.push({
      type,
      geo,
      px,
      length_ft,
      debug_only: true,
      customer_ready: false,
      candidate_source: "phase3A",
      validation_status: "candidate_only",
      reason_not_reportable: "runtime_preempted_before_validated_topology",
    });
  };

  for (const e of eaves) pushEdge(e, "eave");
  for (const r of rakes) pushEdge(r, "rake");

  // Fallback: if topology had no typed edges but a perimeter ring is present,
  // emit it as a single debug perimeter polyline (sliced segments) so the
  // diagram has something to render.
  if (out.length === 0 && Array.isArray(ring) && ring.length >= 2) {
    for (let i = 0; i < ring.length - 1; i++) {
      if (out.length >= MAX_DEBUG_ROOF_LINES) break;
      const a = ring[i];
      const b = ring[i + 1];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      out.push({
        type: "perimeter",
        geo: [[Number(a[0]), Number(a[1])], [Number(b[0]), Number(b[1])]],
        px: null,
        length_ft: null,
        debug_only: true,
        customer_ready: false,
        candidate_source: "phase3A",
        validation_status: "candidate_only",
        reason_not_reportable: "runtime_preempted_before_validated_topology",
      });
    }
  }

  return out;
}

function sanitizeTargetMaskIsolation(raw: any): any {
  if (!raw || typeof raw !== "object") return raw ?? null;
  // Drop the heaviest fields (raw mask grids) — keep diagnostics only.
  const { target_mask_grid, global_mask_grid, mask_pixels, ...rest } =
    raw as Record<string, unknown>;
  return rest;
}

export function buildPreTopologyDebugBag(args: {
  stage: PreTopologyStage;
  dsmGrid: any;
  maskedDSM: any;
  roofMask: any;
  raster: any;
  perimeterPhase0Snapshot: any;
  perimeterTopologySnapshot: any;
  targetMaskIsolation: any;
  footprintSource: string | null;
  footprintGeo: Array<[number, number]> | null;
  footprintPx: Array<[number, number]> | null;
  registration?: any;
  /**
   * Canonical registration transform package (output of
   * `buildRegistrationTransformPackage`). When provided, the aerial graph
   * builder receives a fully-formed `registration` object so it can succeed
   * even if the legacy flat `geoToRasterTransform` / `rasterBoundsLatLng`
   * args are null at this call site.
   */
  transformPackage?: any;
  overlayDebug?: any;
  debugLayers?: any;
  dsmPlanarGraphDebug?: any;
  debugRoofLines?: any;
  rasterUrl?: string | null;
  rasterBoundsLatLng?: unknown;
  geoToRasterTransform?: unknown;
  solarSegments?: unknown;
  maskComponentsTable?: unknown;
  confirmedRoofCenterPx?: unknown;
  staticMapCenterLatLng?: unknown;
}): PreTopologyDebugBag {

  const dsmSplit = buildDsmSplitStatus({
    dsmGrid: args.dsmGrid,
    maskedDSM: args.maskedDSM,
    roofMask: args.roofMask,
    raster: args.raster,
    registration: args.registration,
  });

  const footprintPxCount = Array.isArray(args.footprintPx)
    ? args.footprintPx.length
    : 0;
  const footprintGeoCount = Array.isArray(args.footprintGeo)
    ? args.footprintGeo.length
    : 0;
  const footprintPxSliced: Array<[number, number]> | null =
    Array.isArray(args.footprintPx)
      ? (args.footprintPx.slice(0, MAX_FOOTPRINT_PX_POINTS) as Array<
        [number, number]
      >)
      : null;
  const footprintValid = (footprintPxCount >= 3) || (footprintGeoCount >= 3);

  // Lift raw perimeter (DSM-pixel ring) out of perimeter_topology so the
  // viewer can render the overlay from `phase3_5.raw_perimeter_px` /
  // `debug_layers.raw_perimeter_px` even when refinement never ran.
  const ringPx = args.perimeterTopologySnapshot?.perimeter_ring_px;
  const rawPerimeterPx: Array<[number, number]> | null =
    Array.isArray(ringPx) && ringPx.length >= 3
      ? (ringPx.map((p: any) =>
        Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p?.x), Number(p?.y)]
      ).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) as Array<
        [number, number]
      >)
      : null;

  // Canonical registration object passed to the aerial graph builder.
  // Built from transformPackage + flat hoisted fields so the resolver in
  // aerial-candidate-graph.ts always has a complete view, regardless of
  // which call site invoked the bag.
  const pkg = args.transformPackage ?? null;
  const rasterSizePx = pkg?.raster_size_px ??
    (args.raster?.width && args.raster?.height
      ? { width: args.raster.width, height: args.raster.height }
      : null);
  const registrationForGraph = args.registration ?? {
    transform_package: pkg,
    geo_to_raster_transform: args.geoToRasterTransform ??
      pkg?.geo_to_raster_transform ?? null,
    raster_bounds_lat_lng: args.rasterBoundsLatLng ??
      pkg?.raster_bounds_lat_lng ?? null,
    confirmed_roof_center_px: args.confirmedRoofCenterPx ??
      pkg?.confirmed_roof_center_px ?? null,
    raster_size_px: rasterSizePx,
    raster: { url: args.rasterUrl ?? null, size_px: rasterSizePx },
  };

  const aerialCandidateRoofGraph = buildAerialCandidateGraph({
    rasterUrl: args.rasterUrl ?? null,
    rasterBoundsLatLng: args.rasterBoundsLatLng ??
      pkg?.raster_bounds_lat_lng ?? null,
    geoToRasterTransform: args.geoToRasterTransform ??
      pkg?.geo_to_raster_transform ?? null,
    perimeterTopology: args.perimeterTopologySnapshot,
    targetMaskIsolation: args.targetMaskIsolation,
    solarSegments: args.solarSegments,
    maskComponentsTable: args.maskComponentsTable,
    confirmedRoofCenterPx: args.confirmedRoofCenterPx ??
      pkg?.confirmed_roof_center_px ?? null,
    staticMapCenterLatLng: args.staticMapCenterLatLng,
    registration: registrationForGraph,
    overlayDebug: args.overlayDebug ?? null,
    debugLayers: args.debugLayers ?? null,
    dsmPlanarGraphDebug: args.dsmPlanarGraphDebug ?? null,
    debugRoofLines: args.debugRoofLines ?? null,
  });


  const dsmTransformPresent =
    dsmSplit.georegistration_transform.dsm_to_raster_transform_present &&
    dsmSplit.georegistration_transform.geo_to_dsm_transform_present &&
    dsmSplit.georegistration_transform.dsm_pixel_transform_valid;
  const dsmValidationStatus: { available: boolean; reason: string | null } =
    !dsmSplit.dsm_loaded
      ? { available: false, reason: "dsm_not_loaded" }
      : dsmTransformPresent
      ? { available: true, reason: null }
      : { available: false, reason: "invalid_transform" };
  const primaryGeometrySource = aerialCandidateRoofGraph.executed
    ? "aerial_registered"
    : null;


  return {
    dsm_split_status: dsmSplit,
    perimeter_phase0: args.perimeterPhase0Snapshot ?? null,
    perimeter_topology: args.perimeterTopologySnapshot ?? null,
    target_mask_isolation: sanitizeTargetMaskIsolation(args.targetMaskIsolation),
    footprint_source: args.footprintSource ?? null,
    footprint_valid: footprintValid,
    footprint_point_count: Math.max(footprintPxCount, footprintGeoCount),
    footprint_px: footprintPxSliced,
    debug_roof_lines: buildDebugRoofLines(args.perimeterTopologySnapshot),
    debug_layers_persisted_at_stage: args.stage,
    dsm_loaded: dsmSplit.dsm_loaded || dsmSplit.masked_dsm_loaded,
    mask_loaded: dsmSplit.mask_loaded || dsmSplit.masked_dsm_loaded,
    raster_loaded: dsmSplit.raster_loaded,
    raw_perimeter_px: rawPerimeterPx,
    aerial_candidate_roof_graph: aerialCandidateRoofGraph,
    primary_geometry_source: primaryGeometrySource,
    dsm_validation_status: dsmValidationStatus,
    registration: registrationForGraph,
  } as PreTopologyDebugBag;
}



// ────────────────────────────────────────────────────────────────────────
// CPU-budget terminal debug payload (pure shaping for the failure row).
// ────────────────────────────────────────────────────────────────────────

export interface CpuBudgetConstants {
  AI_MEASUREMENT_CPU_BUDGET_MS: number;
  AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS: number;
  AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT: number;
  AI_MEASUREMENT_CPU_TIMEOUT_STAGE: string;
  AI_MEASUREMENT_CPU_TIMEOUT_REASON: string;
  REQUIRED_TOPOLOGY_SOURCE: string;
}

export interface CpuBudgetSnapshot {
  preempt: boolean;
  elapsed_ms: number;
  remaining_ms: number;
  reason: string | null;
}

export function buildCpuBudgetTerminalDebugPayload(args: {
  stage: string;
  estimatedWorkUnits: number | null;
  debug: Record<string, unknown> | undefined;
  budget: CpuBudgetSnapshot;
  constants: CpuBudgetConstants;
  /**
   * Optional prior `geometry_report_json` (or any object carrying
   * `estimated_work_units` / `dsm_planar_graph_debug.estimated_work_units`)
   * — used as a fallback so a known nonzero value cannot be regressed to 0
   * during terminal write.
   */
  priorGeometry?: Record<string, unknown> | null;
  /**
   * Optional `topologyEstimate.work_units` from an earlier estimator pass.
   */
  topologyEstimateWorkUnits?: number | null;
}): Record<string, unknown> {
  const incoming = args.debug ?? {};
  const dsmSplitStatus = (incoming as any).dsm_split_status ?? null;
  const debugRoofLines = Array.isArray((incoming as any).debug_roof_lines)
    ? (incoming as any).debug_roof_lines
    : [];
  const debugStage = (incoming as any).debug_layers_persisted_at_stage ??
    args.stage;
  const targetMaskIsolation = (incoming as any).target_mask_isolation ?? null;
  const rawPerimeterPx = (incoming as any).raw_perimeter_px ?? null;
  const perimeterTopology = (incoming as any).perimeter_topology ?? null;
  const incomingRegistration = (incoming as any).registration ?? null;

  // Merge-precedence guard: an executed aerial candidate graph must NEVER be
  // downgraded by a later skipped graph passed via `incoming`. The upstream
  // `buildPreTopologyDebugBag` builds the canonical graph and hands it in
  // here; this is belt-and-suspenders against any future caller that tries
  // to slip a stale/empty graph into the terminal payload.
  let aerialCandidateRoofGraph =
    (incoming as any).aerial_candidate_roof_graph ?? null;
  let aerialGraphRebuiltFromFinalPayload = false;

  // ── Final-payload fallback rebuild ──────────────────────────────────────
  // If the graph skipped with `raster_transform_unavailable` but the final
  // payload now carries a complete registration package AND perimeter
  // topology, rebuild the graph rather than persisting a stale skip.
  if (
    aerialCandidateRoofGraph?.skipped_reason ===
      "raster_transform_unavailable" &&
    incomingRegistration?.transform_package?.geo_to_raster_transform &&
    incomingRegistration?.transform_package?.raster_bounds_lat_lng &&
    (Array.isArray((perimeterTopology as any)?.perimeter_ring_px) &&
      (perimeterTopology as any).perimeter_ring_px.length >= 3) &&
    (
      (Array.isArray((perimeterTopology as any)?.eave_edges) &&
        (perimeterTopology as any).eave_edges.length > 0) ||
      (Array.isArray((perimeterTopology as any)?.perimeter_edges) &&
        (perimeterTopology as any).perimeter_edges.length > 0)
    )
  ) {
    const rebuilt = buildAerialCandidateGraph({
      registration: incomingRegistration,
      geoToRasterTransform:
        incomingRegistration.transform_package.geo_to_raster_transform,
      rasterBoundsLatLng:
        incomingRegistration.transform_package.raster_bounds_lat_lng,
      confirmedRoofCenterPx:
        incomingRegistration.transform_package.confirmed_roof_center_px ??
          incomingRegistration.confirmed_roof_center_px ?? null,
      rasterUrl: incomingRegistration?.raster?.url ?? null,
      perimeterTopology,
      targetMaskIsolation,
      debugLayers: (incoming as any).debug_layers ?? null,
      debugRoofLines: (incoming as any).debug_roof_lines ?? null,
      dsmPlanarGraphDebug: (incoming as any).dsm_planar_graph_debug ?? null,
    });
    aerialCandidateRoofGraph = {
      ...rebuilt,
      aerial_graph_rebuilt_from_final_payload: true,
    };
    aerialGraphRebuiltFromFinalPayload = true;
  }

  // ── Skip-diagnostic guarantee ───────────────────────────────────────────
  // Any executed=false aerial graph MUST carry a skip_debug block. If a
  // caller stuffed a skipped graph in without one, synthesize it from what
  // we know so consumers always have actionable diagnostics.
  if (
    aerialCandidateRoofGraph &&
    aerialCandidateRoofGraph.executed === false &&
    !aerialCandidateRoofGraph.skip_debug
  ) {
    aerialCandidateRoofGraph = {
      ...aerialCandidateRoofGraph,
      skip_debug: {
        has_perimeter_ring_px: !!(
          perimeterTopology as any
        )?.perimeter_ring_px,
        perimeter_ring_px_source:
          (perimeterTopology as any)?.perimeter_ring_px
            ? "perimeter_topology.perimeter_ring_px"
            : null,
        has_perimeter_ring_geo: !!(
          perimeterTopology as any
        )?.perimeter_ring_geo,
        perimeter_ring_geo_source:
          (perimeterTopology as any)?.perimeter_ring_geo
            ? "perimeter_topology.perimeter_ring_geo"
            : null,
        has_geo_to_raster_transform:
          !!incomingRegistration?.transform_package?.geo_to_raster_transform ||
          !!incomingRegistration?.geo_to_raster_transform,
        geo_to_raster_transform_source:
          incomingRegistration?.transform_package?.geo_to_raster_transform
            ? "registration.transform_package.geo_to_raster_transform"
            : (incomingRegistration?.geo_to_raster_transform
              ? "registration.geo_to_raster_transform"
              : null),
        has_raster_bounds_lat_lng:
          !!incomingRegistration?.transform_package?.raster_bounds_lat_lng ||
          !!incomingRegistration?.raster_bounds_lat_lng,
        raster_bounds_source:
          incomingRegistration?.transform_package?.raster_bounds_lat_lng
            ? "registration.transform_package.raster_bounds_lat_lng"
            : (incomingRegistration?.raster_bounds_lat_lng
              ? "registration.raster_bounds_lat_lng"
              : null),
        has_overlay_raster_url: !!incomingRegistration?.raster?.url,
        raster_registered_basis: null,
        reason: aerialCandidateRoofGraph.skipped_reason ?? "unknown",
        synthesized_at: "buildCpuBudgetTerminalDebugPayload",
      },
    };
  }

  // Fonsica-shaped impossible-skip diagnostic — recompute after rebuild.
  const _g2r =
    (aerialCandidateRoofGraph as any)?.skip_debug?.has_geo_to_raster_transform ===
      true ||
    !!(perimeterTopology as any)?.geo_to_raster_transform ||
    !!incomingRegistration?.transform_package?.geo_to_raster_transform ||
    (aerialCandidateRoofGraph?.executed === true);
  const _bounds =
    (aerialCandidateRoofGraph as any)?.skip_debug?.has_raster_bounds_lat_lng ===
      true ||
    !!(perimeterTopology as any)?.raster_bounds_lat_lng ||
    !!incomingRegistration?.transform_package?.raster_bounds_lat_lng ||
    (aerialCandidateRoofGraph?.executed === true);
  const _ringPx = Array.isArray((perimeterTopology as any)?.perimeter_ring_px)
    ? (perimeterTopology as any).perimeter_ring_px
    : null;
  const _eaves = Array.isArray((perimeterTopology as any)?.eave_edges)
    ? (perimeterTopology as any).eave_edges
    : [];
  const _perim = Array.isArray((perimeterTopology as any)?.perimeter_edges)
    ? (perimeterTopology as any).perimeter_edges
    : [];
  const fonsicaShapedInputs = _g2r && _bounds &&
    Array.isArray(_ringPx) && _ringPx.length >= 3 &&
    (_eaves.length > 0 || _perim.length > 0);
  const aerialGraphImpossibleSkip =
    fonsicaShapedInputs === true &&
    aerialCandidateRoofGraph?.skipped_reason === "raster_transform_unavailable";
  const aerialGraphImpossibleSkipReason = aerialGraphImpossibleSkip
    ? "final_payload_has_registration_and_perimeter_topology"
    : null;

  // ── Preempt timing diagnostics ──────────────────────────────────────────
  const lateCpuPreempt =
    args.budget.elapsed_ms >= args.constants.AI_MEASUREMENT_CPU_BUDGET_MS;

  // ── Preserve estimated_work_units ───────────────────────────────────────
  const preservedWorkUnits = preserveEstimatedWorkUnits({
    estimatedWorkUnits: args.estimatedWorkUnits,
    topologyEstimateWorkUnits: args.topologyEstimateWorkUnits ?? null,
    priorGeometry: args.priorGeometry ?? null,
    incoming,
  });

  const phase3_5 = {
    raw_perimeter_px: rawPerimeterPx,
    refined_perimeter_px: null,
    refined_perimeter_missing_reason:
      "refinement_not_reached_before_cpu_preempt",
  };
  const debug_layers = {
    raw_perimeter_px: rawPerimeterPx,
    selected_perimeter_px: rawPerimeterPx,
  };
  return {
    ...incoming,
    topology_source: args.constants.REQUIRED_TOPOLOGY_SOURCE,
    failure_stage: args.constants.AI_MEASUREMENT_CPU_TIMEOUT_STAGE,
    cpu_budget_stage: args.stage,
    cpu_budget_preempt_reason: args.budget.reason,
    cpu_budget_elapsed_ms: args.budget.elapsed_ms,
    cpu_budget_remaining_ms: args.budget.remaining_ms,
    cpu_budget_ms: args.constants.AI_MEASUREMENT_CPU_BUDGET_MS,
    cpu_terminal_write_reserve_ms:
      args.constants.AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS,
    late_cpu_preempt: lateCpuPreempt,
    estimated_work_units: preservedWorkUnits,
    topology_pixel_limit: args.constants.AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT,
    result_state: "ai_failed_runtime",
    hard_fail_reason: args.constants.AI_MEASUREMENT_CPU_TIMEOUT_REASON,
    block_customer_report_reason:
      args.constants.AI_MEASUREMENT_CPU_TIMEOUT_REASON,
    customer_report_ready: false,
    customer_ready: false,
    diagram_render_intent: "debug_only",
    roof_lines_count: 0,
    debug_roof_lines_count: debugRoofLines.length,
    dsm_split_status: dsmSplitStatus,
    debug_roof_lines: debugRoofLines,
    debug_layers_persisted_at_stage: debugStage,
    target_mask_isolation: targetMaskIsolation,
    perimeter_topology: perimeterTopology,
    raw_perimeter_px: rawPerimeterPx,
    aerial_candidate_roof_graph: aerialCandidateRoofGraph,
    aerial_graph_rebuilt_from_final_payload: aerialGraphRebuiltFromFinalPayload,
    aerial_graph_impossible_skip: aerialGraphImpossibleSkip,
    aerial_graph_impossible_skip_reason: aerialGraphImpossibleSkipReason,
    fonsica_shaped_aerial_inputs: fonsicaShapedInputs,
    primary_geometry_source: (incoming as any).primary_geometry_source ??
      (aerialCandidateRoofGraph?.executed ? "aerial_registered" : null),
    dsm_validation_status: (incoming as any).dsm_validation_status ?? null,
    phase3_5,
    debug_layers,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers exported for use by start-ai-measurement and tests.
// ────────────────────────────────────────────────────────────────────────

/**
 * First non-null, finite, positive integer from the priority list. Used to
 * preserve a known `estimated_work_units` value through the terminal write
 * so it cannot be regressed to 0.
 */
export function preserveEstimatedWorkUnits(args: {
  estimatedWorkUnits?: number | null;
  topologyEstimateWorkUnits?: number | null;
  priorGeometry?: Record<string, unknown> | null;
  incoming?: Record<string, unknown> | null;
  /**
   * v2 fallback: when every richer source is missing/0, fall back to the
   * topology pixel limit so the row never persists `estimated_work_units=0`
   * for a job that clearly had a heavy-work signal upstream.
   */
  topologyPixelLimit?: number | null;
}): number | null {
  const pg = (args.priorGeometry ?? {}) as any;
  const inc = (args.incoming ?? {}) as any;
  const terminal = (inc?.terminal_debug_payload ?? null) as any;
  const candidates: Array<number | null | undefined> = [
    args.estimatedWorkUnits,
    pg?.estimated_work_units,
    pg?.dsm_planar_graph_debug?.estimated_work_units,
    args.topologyEstimateWorkUnits,
    inc?.estimated_work_units,
    inc?.dsm_planar_graph_debug?.estimated_work_units,
    terminal?.estimated_work_units,
    terminal?.pre_phase3_5_preempt?.estimated_work_units,
    // ── v2 cascade tail: topology_pixel_limit fallback ──────────────────
    inc?.topology_pixel_limit,
    args.topologyPixelLimit,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // If everything is missing/zero but the caller still passed an explicit
  // value (even 0), return that rather than null so the contract is honored.
  if (typeof args.estimatedWorkUnits === "number") return args.estimatedWorkUnits;
  return null;
}

/**
 * Rebuilds `geometry_report_json.aerial_candidate_roof_graph` in place when
 * the persisted skip is `raster_transform_unavailable` but the final payload
 * now contains a complete registration package and perimeter topology.
 *
 * Returns:
 *   - `rebuilt`: whether the graph was rebuilt this call
 *   - `impossibleSkip`: whether the post-rebuild state still shows the
 *     impossible-skip condition (registration + perimeter present but graph
 *     still skipped with raster_transform_unavailable)
 *
 * Mutates `geometryReportJson` directly.
 */
export function rebuildAerialGraphFromFinalPayload(
  geometryReportJson: Record<string, unknown>,
): { rebuilt: boolean; impossibleSkip: boolean; impossibleSkipReason: string | null } {
  const g = geometryReportJson as any;
  const acg = g?.aerial_candidate_roof_graph ?? null;
  const reg = g?.registration ?? g?.registration_gate ?? null;
  const perim = g?.perimeter_topology ?? null;

  const hasTransform = !!reg?.transform_package?.geo_to_raster_transform ||
    !!reg?.geo_to_raster_transform;
  const hasBounds = !!reg?.transform_package?.raster_bounds_lat_lng ||
    !!reg?.raster_bounds_lat_lng;
  const ringPx = Array.isArray(perim?.perimeter_ring_px)
    ? perim.perimeter_ring_px
    : null;
  const hasEdges =
    (Array.isArray(perim?.eave_edges) && perim.eave_edges.length > 0) ||
    (Array.isArray(perim?.perimeter_edges) && perim.perimeter_edges.length > 0);

  let rebuilt = false;
  if (
    acg?.skipped_reason === "raster_transform_unavailable" &&
    hasTransform && hasBounds && ringPx && ringPx.length >= 3 && hasEdges
  ) {
    const rebuiltGraph = buildAerialCandidateGraph({
      registration: reg,
      geoToRasterTransform: reg?.transform_package?.geo_to_raster_transform ??
        reg?.geo_to_raster_transform,
      rasterBoundsLatLng: reg?.transform_package?.raster_bounds_lat_lng ??
        reg?.raster_bounds_lat_lng,
      confirmedRoofCenterPx:
        reg?.transform_package?.confirmed_roof_center_px ??
          reg?.confirmed_roof_center_px ?? null,
      rasterUrl: reg?.raster?.url ?? null,
      perimeterTopology: perim,
      targetMaskIsolation: g?.target_mask_isolation ?? null,
      debugLayers: g?.debug_layers ?? null,
      debugRoofLines: g?.debug_roof_lines ?? null,
      dsmPlanarGraphDebug: g?.dsm_planar_graph_debug ?? null,
    });
    g.aerial_candidate_roof_graph = {
      ...rebuiltGraph,
      aerial_graph_rebuilt_from_final_payload: true,
    };
    rebuilt = true;
    if (rebuiltGraph.executed) {
      g.primary_geometry_source = g.primary_geometry_source ??
        "aerial_registered";
    }
  }

  const finalAcg = g.aerial_candidate_roof_graph ?? null;
  const impossibleSkip = !!(
    finalAcg?.skipped_reason === "raster_transform_unavailable" &&
    hasTransform && hasBounds && ringPx && ringPx.length >= 3 && hasEdges
  );
  const impossibleSkipReason = impossibleSkip
    ? "final_payload_has_registration_and_perimeter_topology"
    : null;
  g.aerial_graph_rebuilt_from_final_payload =
    g.aerial_graph_rebuilt_from_final_payload || rebuilt;
  g.aerial_graph_impossible_skip = impossibleSkip;
  g.aerial_graph_impossible_skip_reason = impossibleSkipReason;
  return { rebuilt, impossibleSkip, impossibleSkipReason };
}


// ────────────────────────────────────────────────────────────────────────
// Final-diagram zero-geometry safety guard (success-path).
// ────────────────────────────────────────────────────────────────────────

export interface ZeroGeometryGuardResult {
  applied: boolean;
  reason: string | null;
}

export const ZERO_GEOMETRY_GUARD_REASON =
  "zero_geometry_final_diagram_guard";

/**
 * Mutates `payload` and `geometryReportJson` in place so a success-path write
 * with no roof planes AND no roof edges can never persist as a customer
 * report. Cheap belt-and-suspenders against any upstream regression that
 * lets the geometry collapse before the insert.
 */
export function applyZeroGeometryFinalDiagramGuard(args: {
  facetCount: number;
  roofLinesCount: number;
  payload: Record<string, unknown>;
  geometryReportJson: Record<string, unknown>;
  normalizeResultStateForWrite: (
    state: string,
    debug: Record<string, unknown>,
  ) => string;
}): ZeroGeometryGuardResult {
  if (args.facetCount > 0 || args.roofLinesCount > 0) {
    return { applied: false, reason: null };
  }
  args.payload.customer_report_ready = false;
  args.payload.internal_debug_report_ready = true;
  args.payload.diagram_render_intent = "debug_only";
  args.payload.validation_status = "failed";
  args.payload.block_customer_report_reason = ZERO_GEOMETRY_GUARD_REASON;
  if (!args.payload.hard_fail_reason) {
    args.payload.hard_fail_reason = ZERO_GEOMETRY_GUARD_REASON;
  }
  args.payload.result_state = args.normalizeResultStateForWrite(
    "ai_failed_runtime",
    args.payload,
  );
  args.geometryReportJson.customer_report_ready = false;
  args.geometryReportJson.diagram_render_intent = "debug_only";
  args.geometryReportJson.block_customer_report_reason =
    ZERO_GEOMETRY_GUARD_REASON;
  if (!args.geometryReportJson.hard_fail_reason) {
    args.geometryReportJson.hard_fail_reason = ZERO_GEOMETRY_GUARD_REASON;
  }
  (args.geometryReportJson as any).facet_count = 0;
  (args.geometryReportJson as any).roof_lines_count = 0;
  return { applied: true, reason: ZERO_GEOMETRY_GUARD_REASON };
}
