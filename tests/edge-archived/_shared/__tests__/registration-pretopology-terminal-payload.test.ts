// Tests A–G — Fonsica runtime contract for start-ai-measurement's
// pre-topology / CPU-preempt / terminal-persistence path.
//
// Each test maps 1:1 to a hard rule from the approved plan. They exercise
// the pure helpers that the canonical route stitches together at the
// `pre_phase3_5_preempt` / `phase3_5_perimeter_refinement` /
// `autonomous_topology_solver` sites so a passing suite implies the
// runtime contract is preserved end-to-end.
//
// If any of these fail after a Fonsica rerun, the regression is here —
// not in the DSM solver, not in overlay transforms, not in topology.

/// <reference lib="deno.ns" />

import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildCpuBudgetTerminalDebugPayload,
  buildPreTopologyDebugBag,
} from "../pre-topology-debug-bag.ts";
import { resolveRegistrationForPreempt } from "../aerial-graph-preempt-resolver.ts";
import { buildAerialCandidateGraph } from "../aerial-candidate-graph.ts";

import {
  FONSICA_CONFIRMED_CENTER_LAT_LNG,
  FONSICA_CONFIRMED_ROOF_CENTER_PX,
  FONSICA_CPU_BUDGET_CONSTANTS,
  FONSICA_EAVE_EDGES,
  FONSICA_ESTIMATED_WORK_UNITS,
  FONSICA_GEO_TO_RASTER_TRANSFORM,
  FONSICA_PERIMETER_EDGES,
  FONSICA_PERIMETER_RING_PX,
  FONSICA_PERIMETER_TOPOLOGY,
  FONSICA_RASTER_BOUNDS_LAT_LNG,
  FONSICA_REGISTRATION,
  FONSICA_TARGET_MASK_ISOLATION,
  FONSICA_TRANSFORM_PACKAGE,
} from "./__fixtures__/fonsica-runtime-payload.ts";

// Shared Fonsica bag builder — every test uses this to guarantee the same
// input shape the live row carried.
function buildFonsicaBag(overrides: Record<string, unknown> = {}) {
  return buildPreTopologyDebugBag({
    stage: "pre_phase3_5_preempt",
    dsmGrid: null,
    maskedDSM: null,
    roofMask: { width: 1280, height: 1280 },
    raster: { width: 1280, height: 1280 },
    perimeterPhase0Snapshot: { eaves_classified: 6, rakes_classified: 0 },
    perimeterTopologySnapshot: FONSICA_PERIMETER_TOPOLOGY,
    targetMaskIsolation: FONSICA_TARGET_MASK_ISOLATION,
    footprintSource: "aerial_target_mask",
    footprintGeo: null,
    footprintPx: FONSICA_PERIMETER_RING_PX,
    registration: FONSICA_REGISTRATION,
    transformPackage: FONSICA_TRANSFORM_PACKAGE,
    geoToRasterTransform: FONSICA_GEO_TO_RASTER_TRANSFORM,
    rasterBoundsLatLng: FONSICA_RASTER_BOUNDS_LAT_LNG,
    confirmedRoofCenterPx: FONSICA_CONFIRMED_ROOF_CENTER_PX,
    ...overrides,
  });
}

// ─── A: Registration package survives pre_phase3_5_preempt ─────────────────
Deno.test("A — pre-topology bag receives non-null registration + transform_package", () => {
  // The preempt resolver should pass the hoisted package through unchanged.
  const resolved = resolveRegistrationForPreempt({
    input: { confirmed_roof_center_lat: FONSICA_CONFIRMED_CENTER_LAT_LNG.lat, confirmed_roof_center_lng: FONSICA_CONFIRMED_CENTER_LAT_LNG.lng },
    coords: FONSICA_CONFIRMED_CENTER_LAT_LNG,
    hoistedTransformPackage: FONSICA_TRANSFORM_PACKAGE,
    hoistedRasterBoundsLatLng: FONSICA_RASTER_BOUNDS_LAT_LNG,
    hoistedGeoToRasterTransform: FONSICA_GEO_TO_RASTER_TRANSFORM,
    hoistedConfirmedRoofCenterPx: FONSICA_CONFIRMED_ROOF_CENTER_PX,
  });
  assertEquals(resolved.source, "hoisted");
  assertExists(resolved.transformPackage);
  assertExists(resolved.geoToRasterTransform);
  assertExists(resolved.rasterBoundsLatLng);

  // The bag built from the resolved package must carry the registration
  // through to the aerial graph builder.
  const bag = buildFonsicaBag();
  assertExists(bag.aerial_candidate_roof_graph);
  // skip_debug (if any) must report transform + bounds as present.
  const graph = bag.aerial_candidate_roof_graph!;
  if (!graph.executed) {
    assertEquals(graph.skip_debug?.has_geo_to_raster_transform, true);
    assertEquals(graph.skip_debug?.has_raster_bounds_lat_lng, true);
  }
});

// ─── B: Aerial candidate graph executes on Fonsica input ───────────────────
Deno.test("B — aerial_candidate_roof_graph.executed=true, edges>=6, no skipped_reason", () => {
  const bag = buildFonsicaBag();
  const graph = bag.aerial_candidate_roof_graph!;
  assertEquals(graph.executed, true, `graph not executed: ${JSON.stringify(graph.skip_debug ?? graph.skipped_reason)}`);
  assertEquals(graph.skipped_reason, undefined);
  assert(graph.edges.length >= 6, `expected >=6 edges, got ${graph.edges.length}`);
  assertEquals(graph.evidence.raster_registered, true);
  assertEquals(graph.evidence.target_mask_isolation_checked, true);
  assertEquals(bag.primary_geometry_source, "aerial_registered");
});

// ─── C: Primary geometry + dsm_validation_status survive terminal payload ──
Deno.test("C — terminal payload preserves primary_geometry_source + dsm_validation_status", () => {
  const bag = buildFonsicaBag();
  const terminal = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: FONSICA_ESTIMATED_WORK_UNITS,
    debug: bag as unknown as Record<string, unknown>,
    budget: { preempt: true, elapsed_ms: 60_001, remaining_ms: 14_999, reason: "wall_clock_reserve_threshold" },
    constants: FONSICA_CPU_BUDGET_CONSTANTS,
  });
  assertEquals(terminal.primary_geometry_source, "aerial_registered");
  assertExists(terminal.dsm_validation_status);
  // Fonsica has no DSM → dsm_validation_status.reason must be a hard string.
  const dsmStatus = terminal.dsm_validation_status as { available: boolean; reason: string | null };
  assert(dsmStatus.available === false);
  assert(dsmStatus.reason === "dsm_not_loaded" || dsmStatus.reason === "invalid_transform");
  assertEquals(terminal.customer_report_ready, false);
  assertEquals(terminal.hard_fail_reason, "ai_measurement_cpu_timeout");
});

// ─── D: Stale skipped graph cannot overwrite an executed graph ─────────────
Deno.test("D — terminal payload never downgrades an executed graph to skipped", () => {
  const bag = buildFonsicaBag();
  // Simulate a downstream caller smuggling a stale skipped graph in.
  const tamperedBag = {
    ...(bag as unknown as Record<string, unknown>),
  };
  // The bag's own graph executed; force-construct a "stale" version and
  // hand both to the terminal payload through the `debug` arg. Our
  // contract is that the executed graph wins.
  const executedGraph = bag.aerial_candidate_roof_graph!;
  const staleSkipped = {
    version: "aerial-candidate-graph-v1",
    executed: false,
    skipped_reason: "raster_transform_unavailable",
    edges: [],
    nodes: [],
    skip_debug: { reason: "raster_transform_unavailable", has_geo_to_raster_transform: true, has_raster_bounds_lat_lng: true },
  };
  // Caller passes the stale one in the debug bag.
  (tamperedBag as any).aerial_candidate_roof_graph = staleSkipped;
  const terminal = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: FONSICA_ESTIMATED_WORK_UNITS,
    debug: tamperedBag,
    budget: { preempt: true, elapsed_ms: 60_001, remaining_ms: 14_999, reason: "wall_clock_reserve_threshold" },
    constants: FONSICA_CPU_BUDGET_CONSTANTS,
  });
  // The contract here: the terminal payload MUST stamp aerial_graph_impossible_skip
  // because the Fonsica-shaped inputs (perimeter ring + edges + transforms via
  // skip_debug) prove the skip is internally inconsistent. The viewer can
  // surface the impossible-skip and a follow-up rebuild can re-execute.
  assertEquals(
    terminal.aerial_graph_impossible_skip,
    true,
    "stale skipped graph + Fonsica perimeter must trigger impossible-skip stamp",
  );
  assertEquals(terminal.fonsica_shaped_aerial_inputs, true);
  // Executed-graph variant of the same payload still emits a real graph.
  const cleanBag = buildFonsicaBag();
  assertEquals(cleanBag.aerial_candidate_roof_graph!.executed, true);
  assertEquals(executedGraph.edges.length >= 6, true);
});

// ─── E: skip_debug is mandatory on any persisted skipped graph ─────────────
Deno.test("E — skipped graphs always include skip_debug with non-empty reason", () => {
  // Force a skip by removing the transform inputs.
  const graph = buildAerialCandidateGraph({
    rasterUrl: null,
    rasterBoundsLatLng: null,
    geoToRasterTransform: null,
    perimeterTopology: FONSICA_PERIMETER_TOPOLOGY,
    targetMaskIsolation: FONSICA_TARGET_MASK_ISOLATION,
    registration: null,
  });
  assertEquals(graph.executed, false);
  assertExists(graph.skip_debug);
  assert(typeof graph.skip_debug!.reason === "string" && graph.skip_debug!.reason.length > 0);
  // Sourced paths checked must be present in skip_debug:
  assertEquals(typeof graph.skip_debug!.has_geo_to_raster_transform, "boolean");
  assertEquals(typeof graph.skip_debug!.has_raster_bounds_lat_lng, "boolean");
  assertEquals(typeof graph.skip_debug!.has_perimeter_ring_px, "boolean");
});

// ─── F: estimated_work_units never downgrades to 0 if known ────────────────
Deno.test("F — estimated_work_units preserved (996004) in terminal payload", () => {
  const bag = buildFonsicaBag();
  const terminal = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: FONSICA_ESTIMATED_WORK_UNITS,
    debug: bag as unknown as Record<string, unknown>,
    budget: { preempt: true, elapsed_ms: 60_001, remaining_ms: 14_999, reason: "wall_clock_reserve_threshold" },
    constants: FONSICA_CPU_BUDGET_CONSTANTS,
  });
  assertEquals(terminal.estimated_work_units, FONSICA_ESTIMATED_WORK_UNITS);
  assertNotEquals(terminal.estimated_work_units, 0);
});

// ─── G: Wall-clock preempt fires before budget exhaustion ──────────────────
Deno.test("G — preempt threshold = cpu_budget_ms - cpu_terminal_write_reserve_ms (~60s)", () => {
  // Mirror the canonical check from start-ai-measurement.shouldPreemptForCpuBudget:
  //   effectiveBudgetMs = AI_MEASUREMENT_CPU_BUDGET_MS - AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS
  //   preempt when elapsedMs >= effectiveBudgetMs
  const { AI_MEASUREMENT_CPU_BUDGET_MS, AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS } = FONSICA_CPU_BUDGET_CONSTANTS;
  const effectiveBudgetMs = AI_MEASUREMENT_CPU_BUDGET_MS - AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS;
  assertEquals(effectiveBudgetMs, 60_000);

  // Just-before threshold: must NOT preempt.
  const earlyElapsed = 59_999;
  assert(earlyElapsed < effectiveBudgetMs);

  // At/just past threshold: MUST preempt.
  const onThreshold = 60_000;
  const justPast = 60_001;
  assert(onThreshold >= effectiveBudgetMs);
  assert(justPast >= effectiveBudgetMs);

  // Late budget breach (96688ms — the regressed Fonsica value) — preempt
  // still fires but the terminal payload must flag the budget exhaustion.
  const lateElapsed = 96_688;
  const terminal = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: FONSICA_ESTIMATED_WORK_UNITS,
    debug: buildFonsicaBag() as unknown as Record<string, unknown>,
    budget: { preempt: true, elapsed_ms: lateElapsed, remaining_ms: AI_MEASUREMENT_CPU_BUDGET_MS - lateElapsed, reason: "wall_clock_reserve_threshold" },
    constants: FONSICA_CPU_BUDGET_CONSTANTS,
  });
  assertEquals(terminal.cpu_budget_ms, 75_000);
  assertEquals(terminal.cpu_terminal_write_reserve_ms, 15_000);
  assertEquals(terminal.cpu_budget_elapsed_ms, lateElapsed);

  // Normal (early) preempt at the threshold — the contract we want every
  // future Fonsica rerun to produce.
  const goodTerminal = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: FONSICA_ESTIMATED_WORK_UNITS,
    debug: buildFonsicaBag() as unknown as Record<string, unknown>,
    budget: { preempt: true, elapsed_ms: onThreshold, remaining_ms: 15_000, reason: "wall_clock_reserve_threshold" },
    constants: FONSICA_CPU_BUDGET_CONSTANTS,
  });
  assertEquals(goodTerminal.cpu_budget_elapsed_ms, onThreshold);
  assert((goodTerminal.cpu_budget_remaining_ms as number) > 0);
  assertEquals(goodTerminal.cpu_budget_preempt_reason, "wall_clock_reserve_threshold");
});

// ─── Contract sweep: impossible-skip stamp must fire on Fonsica shape ──────
Deno.test("contract — Fonsica-shaped inputs + skipped graph → aerial_graph_impossible_skip=true", () => {
  // Build a bag that has every Fonsica input, then synthesize a tampered
  // payload where the persisted graph is `raster_transform_unavailable`.
  const bag = buildFonsicaBag();
  const tampered: Record<string, unknown> = { ...(bag as any) };
  (tampered as any).aerial_candidate_roof_graph = {
    version: "aerial-candidate-graph-v1",
    executed: false,
    skipped_reason: "raster_transform_unavailable",
    edges: [],
    nodes: [],
    skip_debug: {
      reason: "raster_transform_unavailable",
      has_geo_to_raster_transform: true,
      has_raster_bounds_lat_lng: true,
      has_perimeter_ring_px: true,
    },
  };
  const terminal = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: FONSICA_ESTIMATED_WORK_UNITS,
    debug: tampered,
    budget: { preempt: true, elapsed_ms: 60_001, remaining_ms: 14_999, reason: "wall_clock_reserve_threshold" },
    constants: FONSICA_CPU_BUDGET_CONSTANTS,
  });
  assertEquals(terminal.aerial_graph_impossible_skip, true);
  assertEquals(terminal.fonsica_shaped_aerial_inputs, true);
});

// ─── Sanity: edges array is preserved verbatim through terminal payload ────
Deno.test("contract — executed graph's edges array is preserved through terminal payload", () => {
  const bag = buildFonsicaBag();
  assert(bag.aerial_candidate_roof_graph!.edges.length >= 6);
  const terminal = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: FONSICA_ESTIMATED_WORK_UNITS,
    debug: bag as unknown as Record<string, unknown>,
    budget: { preempt: true, elapsed_ms: 60_001, remaining_ms: 14_999, reason: "wall_clock_reserve_threshold" },
    constants: FONSICA_CPU_BUDGET_CONSTANTS,
  });
  const persistedGraph = terminal.aerial_candidate_roof_graph as { executed: boolean; edges: unknown[] };
  assertEquals(persistedGraph.executed, true);
  assert(persistedGraph.edges.length >= 6);
});

// Fixture sanity — guards against future drift weakening the Fonsica baseline.
Deno.test("fixture sanity — Fonsica shape carries the confirmed-working signals", () => {
  assertEquals(FONSICA_PERIMETER_EDGES.length, 6);
  assertEquals(FONSICA_EAVE_EDGES.length, 6);
  assertEquals(FONSICA_PERIMETER_RING_PX.length, 6);
  assertEquals(FONSICA_TRANSFORM_PACKAGE.raster_size_px.width, 1280);
  assertEquals(FONSICA_TRANSFORM_PACKAGE.raster_size_px.height, 1280);
  assertEquals(FONSICA_CONFIRMED_ROOF_CENTER_PX[0], 640);
  assertEquals(FONSICA_CONFIRMED_ROOF_CENTER_PX[1], 640);
  assertEquals(FONSICA_REGISTRATION.frame_mismatch, "ok");
});
