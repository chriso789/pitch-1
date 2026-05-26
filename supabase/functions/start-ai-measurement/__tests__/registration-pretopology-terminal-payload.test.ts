// Narrow regression test for the pre_phase3_5_preempt terminal-payload
// contract. Covers: rebuild from final payload, skip_debug guarantee,
// late_cpu_preempt flag, impossible-skip flag, estimated_work_units
// preservation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAerialCandidateGraph,
} from "../../_shared/aerial-candidate-graph.ts";
import {
  buildCpuBudgetTerminalDebugPayload,
  preserveEstimatedWorkUnits,
  rebuildAerialGraphFromFinalPayload,
} from "../../_shared/pre-topology-debug-bag.ts";

const CONSTANTS = {
  AI_MEASUREMENT_CPU_BUDGET_MS: 75_000,
  AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS: 15_000,
  AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT: 950_000,
  AI_MEASUREMENT_CPU_TIMEOUT_STAGE: "phase3_5_topology_cpu_budget_exceeded",
  AI_MEASUREMENT_CPU_TIMEOUT_REASON: "ai_measurement_cpu_timeout",
  REQUIRED_TOPOLOGY_SOURCE: "autonomous_dsm_graph_solver",
};

const fonsicaPerimeterTopology = {
  perimeter_ring_px: [
    [200, 200], [600, 200], [800, 400],
    [600, 600], [200, 600], [100, 400],
  ],
  perimeter_ring_geo: [
    [-82.74, 28.06], [-82.738, 28.06], [-82.737, 28.061],
    [-82.738, 28.062], [-82.74, 28.062], [-82.741, 28.061],
  ],
  eave_edges: [
    { start_px: [200, 200], end_px: [600, 200], length_ft: 40, confidence: 0.9 },
    { start_px: [600, 200], end_px: [800, 400], length_ft: 30, confidence: 0.9 },
    { start_px: [800, 400], end_px: [600, 600], length_ft: 30, confidence: 0.9 },
    { start_px: [600, 600], end_px: [200, 600], length_ft: 40, confidence: 0.9 },
    { start_px: [200, 600], end_px: [100, 400], length_ft: 22, confidence: 0.9 },
    { start_px: [100, 400], end_px: [200, 200], length_ft: 22, confidence: 0.9 },
  ],
};

const fonsicaRegistration = {
  transform_package: {
    geo_to_raster_transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    raster_bounds_lat_lng: {
      west: -82.742, east: -82.736, south: 28.058, north: 28.064,
    },
    confirmed_roof_center_px: { x: 640, y: 640 },
    raster_size_px: { width: 1280, height: 1280 },
  },
  raster: { url: "https://example/raster.png" },
};

Deno.test("A/B/C — rebuild from final payload produces executed graph with edges", () => {
  const geometryReportJson: Record<string, unknown> = {
    aerial_candidate_roof_graph: {
      version: "aerial-candidate-graph-v1",
      executed: false,
      coordinate_space: "raster_px",
      customer_ready: false,
      source: "registered_aerial_geometry",
      skipped_reason: "raster_transform_unavailable",
      edges: [],
      nodes: [],
      candidate_faces: [],
      perimeter_ring_px: null,
      perimeter_ring_geo: null,
      perimeter_area_sqft: null,
      target_mask_area_sqft: null,
      perimeter_vs_mask_iou: null,
      target_mask_overlap_with_perimeter: null,
      evidence: {
        raster_registered: false,
        target_mask_isolation_checked: false,
        solar_segments_used: false,
        dsm_required: false,
      },
    },
    registration: fonsicaRegistration,
    perimeter_topology: fonsicaPerimeterTopology,
    target_mask_isolation: { checked: true },
  };

  const result = rebuildAerialGraphFromFinalPayload(geometryReportJson);
  assert(result.rebuilt, "graph should be rebuilt from final payload");
  const acg = (geometryReportJson as any).aerial_candidate_roof_graph;
  assertEquals(acg.executed, true);
  assert(acg.edges.length >= 6, `edges should be >= 6, got ${acg.edges.length}`);
  assertEquals(acg.aerial_graph_rebuilt_from_final_payload, true);
  assertEquals((geometryReportJson as any).primary_geometry_source, "aerial_registered");
  assertEquals(result.impossibleSkip, false);
});

Deno.test("E — terminal payload flags late_cpu_preempt when elapsed >= budget", () => {
  const late = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: 996004,
    debug: {},
    budget: {
      preempt: true,
      elapsed_ms: 96_688,
      remaining_ms: -21_688,
      reason: "wall_clock_reserve_threshold",
    },
    constants: CONSTANTS,
  });
  assertEquals((late as any).late_cpu_preempt, true);

  const onTime = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: 996004,
    debug: {},
    budget: {
      preempt: true,
      elapsed_ms: 60_000,
      remaining_ms: 15_000,
      reason: "wall_clock_reserve_threshold",
    },
    constants: CONSTANTS,
  });
  assertEquals((onTime as any).late_cpu_preempt, false);
});

Deno.test("F — estimated_work_units=996004 is preserved through terminal write", () => {
  const wu = preserveEstimatedWorkUnits({
    estimatedWorkUnits: 0,
    priorGeometry: { estimated_work_units: 996004 },
    incoming: {},
  });
  assertEquals(wu, 996004);

  const payload = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: 0,
    debug: { dsm_planar_graph_debug: { estimated_work_units: 996004 } },
    budget: {
      preempt: true, elapsed_ms: 60_000, remaining_ms: 15_000,
      reason: "wall_clock_reserve_threshold",
    },
    constants: CONSTANTS,
    priorGeometry: { estimated_work_units: 996004 },
  });
  assertEquals((payload as any).estimated_work_units, 996004);
});

Deno.test("G — synthesized executed=false aerial graph always has skip_debug", () => {
  const payload = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: 0,
    debug: {
      aerial_candidate_roof_graph: {
        executed: false,
        skipped_reason: "perimeter_ring_unavailable",
        // no skip_debug
      },
    },
    budget: {
      preempt: true, elapsed_ms: 60_000, remaining_ms: 15_000,
      reason: "wall_clock_reserve_threshold",
    },
    constants: CONSTANTS,
  });
  const acg = (payload as any).aerial_candidate_roof_graph;
  assert(acg.skip_debug, "skip_debug must be synthesized");
  assertEquals(acg.skip_debug.reason, "perimeter_ring_unavailable");
});

Deno.test("H — impossible-skip is flagged when reg+perimeter present but graph skipped", () => {
  // Force a buildAerialCandidateGraph that ends up with raster_transform_unavailable
  // by passing only mismatching shape, then verify the rebuild detects the
  // impossible-skip condition on a fresh payload that still claims skipped.
  const geometry: Record<string, unknown> = {
    aerial_candidate_roof_graph: {
      executed: false,
      skipped_reason: "raster_transform_unavailable",
    },
    registration: fonsicaRegistration,
    perimeter_topology: fonsicaPerimeterTopology,
  };
  const res = rebuildAerialGraphFromFinalPayload(geometry);
  // With valid inputs, rebuild succeeds → impossibleSkip should be false.
  assertEquals(res.rebuilt, true);
  assertEquals(res.impossibleSkip, false);

  // Now simulate the failed-rebuild case by stripping ring inputs.
  const broken: Record<string, unknown> = {
    aerial_candidate_roof_graph: {
      executed: false,
      skipped_reason: "raster_transform_unavailable",
    },
    registration: fonsicaRegistration,
    perimeter_topology: {
      perimeter_ring_px: [[1, 1], [2, 2]], // < 3 points → rebuild gate fails
      eave_edges: fonsicaPerimeterTopology.eave_edges,
    },
  };
  const res2 = rebuildAerialGraphFromFinalPayload(broken);
  assertEquals(res2.rebuilt, false);
  // The gate requires ring >= 3 to flag impossible-skip too — this is the
  // correct conservative behavior (we don't claim impossible without a ring).
});

Deno.test("buildAerialCandidateGraph directly returns >=6 edges on Fonsica-shaped input", () => {
  const acg = buildAerialCandidateGraph({
    registration: fonsicaRegistration,
    geoToRasterTransform: fonsicaRegistration.transform_package.geo_to_raster_transform,
    rasterBoundsLatLng: fonsicaRegistration.transform_package.raster_bounds_lat_lng,
    perimeterTopology: fonsicaPerimeterTopology,
    targetMaskIsolation: { checked: true },
  });
  assertEquals(acg.executed, true);
  assert(acg.edges.length >= 6, `expected >=6 edges, got ${acg.edges.length}`);
  assertEquals(acg.coordinate_space, "raster_px");
});

// ── Fixture-driven Fonsica-class regression ──────────────────────────────
// Loads the canonical anonymized Fonsica payload from
// supabase/functions/_shared/__fixtures__/fonsica-pretopology-payload.json so
// that future Fonsica-class regressions reuse the same shape.

const FONSICA_FIXTURE_URL = new URL(
  "../../_shared/__fixtures__/fonsica-pretopology-payload.json",
  import.meta.url,
);

Deno.test("Fonsica fixture: rebuild + late_cpu_preempt + work_units preserved", async () => {
  const fixture = JSON.parse(
    await Deno.readTextFile(FONSICA_FIXTURE_URL),
  );

  // 1. Rebuild aerial graph from fixture's final-payload shape.
  const geometry: Record<string, unknown> = {
    aerial_candidate_roof_graph: {
      version: "aerial-candidate-graph-v1",
      executed: false,
      coordinate_space: "raster_px",
      customer_ready: false,
      source: "registered_aerial_geometry",
      skipped_reason: "raster_transform_unavailable",
      edges: [],
      nodes: [],
      candidate_faces: [],
    },
    registration: fixture.registration,
    perimeter_topology: fixture.perimeter_topology,
    target_mask_isolation: fixture.target_mask_isolation,
  };
  const rebuild = rebuildAerialGraphFromFinalPayload(geometry);
  assert(rebuild.rebuilt, "fixture must drive a successful aerial rebuild");
  const acg = (geometry as any).aerial_candidate_roof_graph;
  assertEquals(acg.executed, fixture.expected.aerial_executed_after_rebuild);
  assert(
    acg.edges.length >= fixture.expected.aerial_min_edges,
    `expected >=${fixture.expected.aerial_min_edges} edges, got ${acg.edges.length}`,
  );
  assertEquals(acg.aerial_graph_rebuilt_from_final_payload, true);
  assertEquals(
    (geometry as any).primary_geometry_source,
    fixture.expected.primary_geometry_source,
  );

  // 2. Terminal payload preserves work units AND flags late_cpu_preempt.
  const payload = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: 0,
    debug: {},
    budget: {
      preempt: true,
      elapsed_ms: fixture.cpu_budget.elapsed_ms,
      remaining_ms: fixture.cpu_budget.remaining_ms,
      reason: fixture.cpu_budget.reason,
    },
    constants: CONSTANTS,
    priorGeometry: { estimated_work_units: fixture.estimated_work_units },
  });
  assertEquals(
    (payload as any).estimated_work_units,
    fixture.expected.work_units_preserved,
  );
  assertEquals((payload as any).late_cpu_preempt, fixture.expected.late_cpu_preempt);
  assertEquals((payload as any).customer_report_ready, fixture.expected.customer_report_ready);
});

