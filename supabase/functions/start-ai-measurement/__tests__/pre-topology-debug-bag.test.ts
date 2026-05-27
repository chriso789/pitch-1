import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyZeroGeometryFinalDiagramGuard,
  buildCpuBudgetTerminalDebugPayload,
  buildPreTopologyDebugBag,
  ZERO_GEOMETRY_GUARD_REASON,
} from "../../_shared/pre-topology-debug-bag.ts";

const STAGE = "phase3_5_perimeter_refinement" as const;

Deno.test("buildPreTopologyDebugBag: null DSM/mask/raster yields all-false split status", () => {
  const bag = buildPreTopologyDebugBag({
    stage: STAGE,
    dsmGrid: null,
    maskedDSM: null,
    roofMask: null,
    raster: null,
    perimeterPhase0Snapshot: null,
    perimeterTopologySnapshot: null,
    targetMaskIsolation: null,
    footprintSource: null,
    footprintGeo: null,
    footprintPx: null,
  });
  assertEquals(bag.dsm_split_status.dsm_loaded, false);
  assertEquals(bag.dsm_split_status.mask_loaded, false);
  assertEquals(bag.dsm_split_status.raster_loaded, false);
  assertEquals(bag.dsm_split_status.dsm_size_px, null);
  assertEquals(bag.debug_roof_lines.length, 0);
  assertEquals(bag.debug_layers_persisted_at_stage, STAGE);
  assertEquals(bag.footprint_valid, false);
});

Deno.test("buildPreTopologyDebugBag: present DSM + mask + raster flips flags", () => {
  const bag = buildPreTopologyDebugBag({
    stage: STAGE,
    dsmGrid: { width: 256, height: 256, resolution: 0.5 },
    maskedDSM: { width: 256, height: 256 },
    roofMask: { points: [] },
    raster: { width: 1280, height: 1280, data: new Uint8Array(4) },
    perimeterPhase0Snapshot: { ok: true },
    perimeterTopologySnapshot: null,
    targetMaskIsolation: { keep: 1, target_mask_grid: new Uint8Array(1) },
    footprintSource: "google_solar",
    footprintGeo: [[1, 1], [2, 2], [3, 3]],
    footprintPx: null,
  });
  assert(bag.dsm_split_status.dsm_loaded);
  assert(bag.dsm_split_status.mask_loaded);
  assert(bag.dsm_split_status.raster_loaded);
  assertEquals(bag.dsm_split_status.dsm_size_px, { width: 256, height: 256 });
  assertEquals(bag.dsm_split_status.dsm_resolution_mpp, 0.5);
  assertEquals(bag.footprint_valid, true);
  // Heavy mask grid stripped from target_mask_isolation
  assertEquals((bag.target_mask_isolation as any)?.target_mask_grid, undefined);
  assertEquals((bag.target_mask_isolation as any)?.keep, 1);
});

Deno.test("buildPreTopologyDebugBag: perimeter edges produce debug-only / not-customer-ready lines", () => {
  const bag = buildPreTopologyDebugBag({
    stage: STAGE,
    dsmGrid: null,
    maskedDSM: null,
    roofMask: null,
    raster: null,
    perimeterPhase0Snapshot: null,
    perimeterTopologySnapshot: {
      eave_edges: [
        { geo: [[-82.45, 27.95], [-82.46, 27.95]] },
        { start: { lng: -82.46, lat: 27.95 }, end: { lng: -82.46, lat: 27.96 } },
      ],
      rake_edges: [
        { geo: [[-82.46, 27.96], [-82.45, 27.96]] },
      ],
    },
    targetMaskIsolation: null,
    footprintSource: null,
    footprintGeo: null,
    footprintPx: null,
  });
  assertEquals(bag.debug_roof_lines.length, 3);
  for (const ln of bag.debug_roof_lines) {
    assertEquals(ln.debug_only, true);
    assertEquals(ln.customer_ready, false);
    assert(["eave", "rake", "perimeter", "unknown"].includes(ln.type));
  }
});

Deno.test("buildCpuBudgetTerminalDebugPayload: lifts cheap evidence + forces customer_report_ready=false", () => {
  const bag = buildPreTopologyDebugBag({
    stage: STAGE,
    dsmGrid: { width: 256, height: 256 },
    maskedDSM: null,
    roofMask: { ok: 1 },
    raster: { width: 1280, height: 1280 },
    perimeterPhase0Snapshot: { phase: 0 },
    perimeterTopologySnapshot: {
      eave_edges: [{ geo: [[0, 0], [1, 1]] }],
      rake_edges: [],
    },
    targetMaskIsolation: { keep: true },
    footprintSource: "google_solar",
    footprintGeo: [[0, 0], [1, 0], [1, 1]],
    footprintPx: null,
  });
  const out = buildCpuBudgetTerminalDebugPayload({
    stage: STAGE,
    estimatedWorkUnits: 12345,
    debug: bag as unknown as Record<string, unknown>,
    budget: { preempt: true, elapsed_ms: 9000, remaining_ms: 500, reason: "x" },
    constants: {
      AI_MEASUREMENT_CPU_BUDGET_MS: 10000,
      AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS: 1000,
      AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT: 1_000_000,
      AI_MEASUREMENT_CPU_TIMEOUT_STAGE: "cpu_budget",
      AI_MEASUREMENT_CPU_TIMEOUT_REASON: "ai_measurement_cpu_budget_exceeded",
      REQUIRED_TOPOLOGY_SOURCE: "dsm_planar_graph_faces",
    },
  });
  assertEquals((out as any).customer_report_ready, false);
  assertEquals((out as any).customer_ready, false);
  assertEquals((out as any).diagram_render_intent, "debug_only");
  assertEquals((out as any).roof_lines_count, 0);
  assertEquals((out as any).cpu_budget_stage, STAGE);
  assertEquals((out as any).debug_layers_persisted_at_stage, STAGE);
  assert((out as any).dsm_split_status?.dsm_loaded === true);
  assert(Array.isArray((out as any).debug_roof_lines));
  assertEquals((out as any).debug_roof_lines.length, 1);
  assertEquals((out as any).debug_roof_lines[0].debug_only, true);
  assertEquals((out as any).debug_roof_lines[0].customer_ready, false);
});

Deno.test("applyZeroGeometryFinalDiagramGuard: no-op when geometry present", () => {
  const payload: any = { customer_report_ready: true };
  const gjson: any = { customer_report_ready: true };
  const r = applyZeroGeometryFinalDiagramGuard({
    facetCount: 3,
    roofLinesCount: 12,
    payload,
    geometryReportJson: gjson,
    normalizeResultStateForWrite: (s) => s,
  });
  assertEquals(r.applied, false);
  assertEquals(payload.customer_report_ready, true);
});

Deno.test("applyZeroGeometryFinalDiagramGuard: forces failure when geometry empty", () => {
  const payload: any = { customer_report_ready: true, hard_fail_reason: null };
  const gjson: any = { customer_report_ready: true };
  const r = applyZeroGeometryFinalDiagramGuard({
    facetCount: 0,
    roofLinesCount: 0,
    payload,
    geometryReportJson: gjson,
    normalizeResultStateForWrite: (s) => `normalized:${s}`,
  });
  assertEquals(r.applied, true);
  assertEquals(r.reason, ZERO_GEOMETRY_GUARD_REASON);
  assertEquals(payload.customer_report_ready, false);
  assertEquals(payload.diagram_render_intent, "debug_only");
  assertEquals(payload.validation_status, "failed");
  assertEquals(payload.block_customer_report_reason, ZERO_GEOMETRY_GUARD_REASON);
  assertEquals(payload.hard_fail_reason, ZERO_GEOMETRY_GUARD_REASON);
  assertEquals(payload.result_state, "normalized:ai_failed_runtime");
  assertEquals(gjson.customer_report_ready, false);
  assertEquals(gjson.diagram_render_intent, "debug_only");
  assertEquals(gjson.facet_count, 0);
  assertEquals(gjson.roof_lines_count, 0);
});
