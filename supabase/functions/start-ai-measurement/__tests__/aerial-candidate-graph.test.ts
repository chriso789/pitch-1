import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAerialCandidateGraph } from "../../_shared/aerial-candidate-graph.ts";

const perimeterTopology = {
  perimeter_ring_px: [[10, 10], [110, 10], [110, 110], [10, 110]],
  perimeter_ring_geo: [
    [-80.0, 26.0],
    [-79.999, 26.0],
    [-79.999, 26.001],
    [-80.0, 26.001],
  ],
  eave_edges: [
    { start_px: [10, 10], end_px: [110, 10], start_geo: [-80.0, 26.0], end_geo: [-79.999, 26.0], length_ft: 80, confidence: 0.9 },
  ],
};

Deno.test("aerial graph builds from registered raster + perimeter ring", () => {
  const g = buildAerialCandidateGraph({
    rasterUrl: "https://example/raster.png",
    rasterBoundsLatLng: { west: -80.001, east: -79.998, south: 25.999, north: 26.002 },
    geoToRasterTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    perimeterTopology,
    targetMaskIsolation: { target_mask_area_sqft: 3200, perimeter_vs_mask_iou: 0.85 },
  });
  assertEquals(g.executed, true);
  assertEquals(g.coordinate_space, "raster_px");
  assertEquals(g.customer_ready, false);
  assert(g.edges.length > 0, "edges should be emitted");
  for (const e of g.edges) {
    assertEquals(e.debug_only, true);
    assertEquals(e.customer_ready, false);
    assertEquals(e.validation_status, "candidate_only");
    assert(Array.isArray(e.start_px) && Array.isArray(e.end_px));
  }
  assert(g.nodes.length > 0);
  assert((g.perimeter_area_sqft ?? 0) > 0);
});

Deno.test("aerial graph skips cleanly without raster transform", () => {
  const g = buildAerialCandidateGraph({ perimeterTopology });
  assertEquals(g.executed, false);
  assertEquals(g.skipped_reason, "raster_transform_unavailable");
  assertEquals(g.edges.length, 0);
});

Deno.test("aerial graph skips when perimeter ring missing", () => {
  const g = buildAerialCandidateGraph({
    rasterBoundsLatLng: {},
    geoToRasterTransform: {},
    perimeterTopology: { eave_edges: [] },
  });
  assertEquals(g.executed, false);
  assertEquals(g.skipped_reason, "perimeter_ring_unavailable");
});
