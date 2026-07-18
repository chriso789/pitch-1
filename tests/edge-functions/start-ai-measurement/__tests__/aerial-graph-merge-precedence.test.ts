// Merge-precedence guard: buildCpuBudgetTerminalDebugPayload must never
// downgrade an executed aerial_candidate_roof_graph to a skipped one.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCpuBudgetTerminalDebugPayload } from "../../_shared/pre-topology-debug-bag.ts";

const CONSTS = {
  AI_MEASUREMENT_CPU_BUDGET_MS: 75000,
  AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS: 10000,
  AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT: 65536,
  AI_MEASUREMENT_CPU_TIMEOUT_STAGE: "cpu_budget_preempt",
  AI_MEASUREMENT_CPU_TIMEOUT_REASON: "ai_measurement_cpu_budget_exceeded",
  REQUIRED_TOPOLOGY_SOURCE: "dsm_planar_graph_v2",
};

const budgetSnap = {
  preempt: true,
  elapsed_ms: 65000,
  remaining_ms: 10000,
  reason: "cpu_budget_exceeded",
};

Deno.test("CPU terminal payload preserves an executed aerial graph", () => {
  const executedGraph = {
    version: "aerial-candidate-graph-v1",
    coordinate_space: "raster_px",
    executed: true,
    customer_ready: false,
    source: "registered_aerial_geometry",
    edges: [{ id: "e_0" }, { id: "e_1" }, { id: "e_2" }, { id: "e_3" }, { id: "e_4" }, { id: "e_5" }],
    nodes: [{ id: "n_0" }],
    candidate_faces: [],
    perimeter_ring_px: [[0, 0], [1, 0], [1, 1]],
    perimeter_ring_geo: null,
    perimeter_area_sqft: 100,
    target_mask_area_sqft: null,
    perimeter_vs_mask_iou: null,
    target_mask_overlap_with_perimeter: null,
    evidence: {
      raster_registered: true,
      raster_registered_basis: "transform",
      target_mask_isolation_checked: true,
      solar_segments_used: false,
      dsm_required: false,
    },
  };

  const payload = buildCpuBudgetTerminalDebugPayload({
    stage: "autonomous_topology_solver",
    estimatedWorkUnits: 1_000_000,
    debug: {
      aerial_candidate_roof_graph: executedGraph,
      primary_geometry_source: "aerial_registered",
      dsm_validation_status: { available: false, reason: "invalid_transform" },
    },
    budget: budgetSnap,
    constants: CONSTS,
  });

  const out = (payload as any).aerial_candidate_roof_graph;
  assertEquals(out.executed, true, "executed graph must be preserved");
  assertEquals(out.edges.length, 6);
  assertEquals((payload as any).primary_geometry_source, "aerial_registered");
});

Deno.test("CPU terminal payload preserves skipped graph + skip_debug when no executed graph available", () => {
  const skippedGraph = {
    version: "aerial-candidate-graph-v1",
    coordinate_space: "raster_px",
    executed: false,
    customer_ready: false,
    source: "registered_aerial_geometry",
    skipped_reason: "raster_transform_unavailable",
    skip_debug: {
      has_perimeter_ring_px: true,
      perimeter_ring_px_source: "perimeter_topology.perimeter_ring_px",
      has_perimeter_ring_geo: true,
      perimeter_ring_geo_source: "perimeter_topology.perimeter_ring_geo",
      has_geo_to_raster_transform: false,
      geo_to_raster_transform_source: null,
      has_raster_bounds_lat_lng: false,
      raster_bounds_source: null,
      has_overlay_raster_url: false,
      raster_registered_basis: null,
      reason: "raster_transform_unavailable",
    },
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
      raster_registered_basis: null,
      target_mask_isolation_checked: false,
      solar_segments_used: false,
      dsm_required: false,
    },
  };

  const payload = buildCpuBudgetTerminalDebugPayload({
    stage: "pre_phase3_5_preempt",
    estimatedWorkUnits: 0,
    debug: { aerial_candidate_roof_graph: skippedGraph },
    budget: budgetSnap,
    constants: CONSTS,
  });

  const out = (payload as any).aerial_candidate_roof_graph;
  assertEquals(out.executed, false);
  assertEquals(out.skipped_reason, "raster_transform_unavailable");
  assert(out.skip_debug, "skip_debug must be preserved on every skipped graph");
  assertEquals(out.skip_debug.reason, "raster_transform_unavailable");
});
