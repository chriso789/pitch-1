// Asserts: when buildPreTopologyDebugBag is called with raster + transform +
// perimeter ring inputs (as wired in start-ai-measurement/index.ts at the CPU
// preempt sites), the resulting debug bag carries a populated
// aerial_candidate_roof_graph that flows through the terminal CPU-budget
// debug payload — i.e. DSM-blocked runs still persist registered aerial
// geometry the viewer can render.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCpuBudgetTerminalDebugPayload,
  buildPreTopologyDebugBag,
} from "../../_shared/pre-topology-debug-bag.ts";

const perimeterTopology = {
  perimeter_ring_px: [[10, 10], [110, 10], [110, 110], [10, 110]],
  perimeter_ring_geo: [
    [-80.0, 26.0],
    [-79.999, 26.0],
    [-79.999, 26.001],
    [-80.0, 26.001],
  ],
  eave_edges: [
    {
      start_px: [10, 10],
      end_px: [110, 10],
      start_geo: [-80.0, 26.0],
      end_geo: [-79.999, 26.0],
      length_ft: 80,
      confidence: 0.9,
    },
  ],
};

Deno.test("CPU-preempt debug bag carries aerial_candidate_roof_graph", () => {
  const bag = buildPreTopologyDebugBag({
    stage: "phase3_5_perimeter_refinement",
    dsmGrid: null,
    maskedDSM: null,
    roofMask: null,
    raster: { width: 1280, height: 1280 },
    perimeterPhase0Snapshot: null,
    perimeterTopologySnapshot: perimeterTopology,
    targetMaskIsolation: { mask_components_table: [] },
    footprintSource: "solar",
    footprintGeo: perimeterTopology.perimeter_ring_geo as any,
    footprintPx: null,
    rasterUrl: "https://example/raster.png",
    rasterBoundsLatLng: {
      west: -80.001,
      east: -79.998,
      south: 25.999,
      north: 26.002,
    },
    geoToRasterTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    solarSegments: [],
    confirmedRoofCenterPx: { x: 640, y: 640 },
    staticMapCenterLatLng: { lat: 26.0005, lng: -79.9995 },
  });
  const graph = (bag as any).aerial_candidate_roof_graph;
  assert(graph, "graph must be present");
  assertEquals(graph.executed, true);
  assertEquals(graph.customer_ready, false);
  assertEquals(graph.coordinate_space, "raster_px");
  assert(Array.isArray(graph.edges) && graph.edges.length > 0);

  const terminal = buildCpuBudgetTerminalDebugPayload({
    bag,
    stage: "phase3_5_perimeter_refinement",
    elapsedMs: 90_000,
    budgetMs: 95_000,
    reason: "wall_clock_reserve_threshold",
  });
  const survived = (terminal as any).aerial_candidate_roof_graph
    ?? (terminal as any)?.debug_layers?.aerial_candidate_roof_graph;
  assert(survived, "aerial graph must survive into terminal CPU payload");
});
