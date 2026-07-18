// Backend regression — raw perimeter + debug roof line px + nested DSM split.
//
// Asserts the slice-3 contract on `buildPreTopologyDebugBag` /
// `buildCpuBudgetTerminalDebugPayload`:
//
//   • raw_perimeter_px lifted from perimeter_topology.perimeter_ring_px and
//     persisted on phase3_5 + debug_layers, with refined_perimeter_missing
//     reason recorded
//   • debug_roof_lines carry derived px pairs and the full set of debug-only
//     flags (debug_only / customer_ready / candidate_source / validation /
//     reason_not_reportable)
//   • dsm_split_status keeps the flat legacy fields and exposes the new
//     nested fetch_decode + georegistration_transform blocks
//
// Together these prove the failure row can never be silently empty even when
// runtime preempts before Phase 3A.5 / topology.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCpuBudgetTerminalDebugPayload,
  buildPreTopologyDebugBag,
} from "../../_shared/pre-topology-debug-bag.ts";

const STAGE = "phase3_5_perimeter_refinement" as const;

const PERIMETER_RING_PX: Array<[number, number]> = [
  [10, 10],
  [110, 10],
  [110, 90],
  [10, 90],
];

Deno.test("raw perimeter px is lifted from perimeter_topology onto phase3_5 + debug_layers", () => {
  const bag = buildPreTopologyDebugBag({
    stage: STAGE,
    dsmGrid: { width: 256, height: 256, resolution: 0.5 },
    maskedDSM: null,
    roofMask: { points: [] },
    raster: { width: 1280, height: 1280 },
    perimeterPhase0Snapshot: { ok: true },
    perimeterTopologySnapshot: {
      perimeter_ring_px: PERIMETER_RING_PX,
      eave_edges: [
        { start_px: [10, 10], end_px: [110, 10], type: "eave" },
      ],
      rake_edges: [],
    },
    targetMaskIsolation: null,
    footprintSource: "google_solar",
    footprintGeo: [[0, 0], [1, 0], [1, 1]],
    footprintPx: null,
  });

  assert(Array.isArray(bag.raw_perimeter_px));
  assertEquals(bag.raw_perimeter_px!.length, PERIMETER_RING_PX.length);

  const terminal = buildCpuBudgetTerminalDebugPayload({
    stage: STAGE,
    estimatedWorkUnits: 0,
    debug: bag as unknown as Record<string, unknown>,
    budget: {
      preempt: true,
      elapsed_ms: 60_000,
      remaining_ms: 15_000,
      reason: "wall_clock_reserve_threshold",
    },
    constants: {
      AI_MEASUREMENT_CPU_BUDGET_MS: 75_000,
      AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS: 15_000,
      AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT: 1_000_000,
      AI_MEASUREMENT_CPU_TIMEOUT_STAGE: "phase3_5_topology_cpu_budget_exceeded",
      AI_MEASUREMENT_CPU_TIMEOUT_REASON: "ai_measurement_cpu_timeout",
      REQUIRED_TOPOLOGY_SOURCE: "dsm_planar_graph_faces",
    },
  }) as any;

  assertEquals(terminal.phase3_5.raw_perimeter_px.length, PERIMETER_RING_PX.length);
  assertEquals(terminal.debug_layers.raw_perimeter_px.length, PERIMETER_RING_PX.length);
  assertEquals(terminal.debug_layers.selected_perimeter_px.length, PERIMETER_RING_PX.length);
  assertEquals(
    terminal.phase3_5.refined_perimeter_missing_reason,
    "refinement_not_reached_before_cpu_preempt",
  );
  assertEquals(terminal.raw_perimeter_px.length, PERIMETER_RING_PX.length);
});

Deno.test("debug_roof_lines derive px from eave start_px/end_px and carry debug-only flags", () => {
  const bag = buildPreTopologyDebugBag({
    stage: STAGE,
    dsmGrid: null,
    maskedDSM: null,
    roofMask: null,
    raster: null,
    perimeterPhase0Snapshot: null,
    perimeterTopologySnapshot: {
      eave_edges: [
        { start_px: [10, 10], end_px: [110, 10], type: "eave" },
        { start_px: [110, 10], end_px: [110, 90], type: "eave" },
      ],
      rake_edges: [
        { start_px: [110, 90], end_px: [10, 90], type: "rake" },
      ],
    },
    targetMaskIsolation: null,
    footprintSource: null,
    footprintGeo: null,
    footprintPx: null,
  });

  assertEquals(bag.debug_roof_lines.length, 3);
  for (const ln of bag.debug_roof_lines) {
    assert(Array.isArray(ln.px) && ln.px!.length === 2);
    assertEquals(ln.debug_only, true);
    assertEquals(ln.customer_ready, false);
    assertEquals(ln.candidate_source, "phase3A");
    assertEquals(ln.validation_status, "candidate_only");
    assertEquals(
      ln.reason_not_reportable,
      "runtime_preempted_before_validated_topology",
    );
  }
});

Deno.test("dsm_split_status preserves flat fields and exposes nested fetch_decode + georegistration_transform", () => {
  // DSM + mask + raster loaded, but no registration transforms provided → the
  // Fonsica failure mode (fetch_decode=pass, georegistration_transform=fail).
  const bag = buildPreTopologyDebugBag({
    stage: STAGE,
    dsmGrid: { width: 998, height: 998, resolution: 0.1 },
    maskedDSM: null,
    roofMask: { ok: true },
    raster: { width: 1280, height: 1280 },
    perimeterPhase0Snapshot: null,
    perimeterTopologySnapshot: null,
    targetMaskIsolation: null,
    footprintSource: null,
    footprintGeo: null,
    footprintPx: null,
    // registration intentionally omitted
  });

  const s = bag.dsm_split_status;
  // Flat (legacy) fields preserved.
  assertEquals(s.dsm_loaded, true);
  assertEquals(s.mask_loaded, true);
  assertEquals(s.raster_loaded, true);
  assertEquals(s.dsm_size_px, { width: 998, height: 998 });
  // Nested contract present.
  assertEquals(s.fetch_decode.status, "pass");
  assertEquals(s.fetch_decode.stage, "dsm_fetch_decode");
  assertEquals(s.georegistration_transform.status, "fail");
  assertEquals(s.georegistration_transform.stage, "dsm_georeg_transform");
  assertEquals(s.georegistration_transform.dsm_tile_bounds_lat_lng_present, false);
  assertEquals(s.georegistration_transform.geo_to_dsm_transform_present, false);
});
