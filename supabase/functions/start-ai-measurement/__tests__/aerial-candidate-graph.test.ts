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

// ── Multi-source resolver regression (aerial-primary handoff fix) ──

const ringPx6 = [
  [100, 100],
  [200, 100],
  [250, 150],
  [200, 250],
  [100, 250],
  [50, 150],
] as Array<[number, number]>;
const ringGeo6 = [
  [-80.0, 26.0],
  [-79.999, 26.0],
  [-79.9985, 26.0005],
  [-79.999, 26.001],
  [-80.0, 26.001],
  [-80.0005, 26.0005],
] as Array<[number, number]>;
const fullTopo = {
  perimeter_ring_px: ringPx6,
  perimeter_ring_geo: ringGeo6,
  eave_edges: ringPx6.map((p, i) => ({
    start_px: p,
    end_px: ringPx6[(i + 1) % ringPx6.length],
    start_geo: ringGeo6[i],
    end_geo: ringGeo6[(i + 1) % ringGeo6.length],
    length_ft: 50,
    confidence: 0.6,
  })),
};

Deno.test("executes with geo_to_raster_transform even when DSM transform absent", () => {
  const g = buildAerialCandidateGraph({
    rasterUrl: "https://example/r.png",
    rasterBoundsLatLng: { west: -80.001, east: -79.998, south: 25.999, north: 26.002 },
    geoToRasterTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    perimeterTopology: fullTopo,
  });
  assertEquals(g.executed, true);
  assert(g.edges.length >= 6, `expected >=6 edges, got ${g.edges.length}`);
  assertEquals(g.evidence.raster_registered, true);
  assertEquals(g.evidence.dsm_required, false);
});

Deno.test("falls back to debug_layers.raw_perimeter_px when perimeter_topology missing ring", () => {
  const g = buildAerialCandidateGraph({
    rasterBoundsLatLng: {},
    geoToRasterTransform: {},
    perimeterTopology: { eave_edges: [] },
    debugLayers: { raw_perimeter_px: ringPx6 },
  });
  assertEquals(g.executed, true);
  assertEquals(g.perimeter_source, "debug_layers.raw_perimeter_px");
  assert(g.edges.length >= 6);
});

Deno.test("falls back to dsm_planar_graph_debug.perimeter_topology.perimeter_ring_px", () => {
  const g = buildAerialCandidateGraph({
    rasterBoundsLatLng: {},
    geoToRasterTransform: {},
    dsmPlanarGraphDebug: {
      perimeter_topology: { perimeter_ring_px: ringPx6 },
    },
  });
  assertEquals(g.executed, true);
  assertEquals(
    g.perimeter_source,
    "dsm_planar_graph_debug.perimeter_topology.perimeter_ring_px",
  );
});

Deno.test("accepts registration.transform_package as raster registration source", () => {
  const g = buildAerialCandidateGraph({
    perimeterTopology: fullTopo,
    registration: {
      transform_package: {
        geo_to_raster_transform: { a: 1 },
        raster_bounds_lat_lng: { west: -80, east: -79.99, south: 26, north: 26.01 },
      },
    },
  });
  assertEquals(g.executed, true);
  assertEquals(g.evidence.raster_registered, true);
});

Deno.test("rasterUrl + bounds alone is sufficient registration (bounds_only basis)", () => {
  const g = buildAerialCandidateGraph({
    rasterUrl: "https://example/r.png",
    rasterBoundsLatLng: { west: -80, east: -79.99, south: 26, north: 26.01 },
    perimeterTopology: fullTopo,
  });
  assertEquals(g.executed, true);
  assertEquals(g.evidence.raster_registered, true);
  assertEquals(g.evidence.raster_registered_basis, "bounds_only");
});

Deno.test("builds edges from perimeter_topology.eave_edges with px+geo endpoints", () => {
  const g = buildAerialCandidateGraph({
    rasterBoundsLatLng: {},
    geoToRasterTransform: {},
    perimeterTopology: fullTopo,
  });
  const eaves = g.edges.filter((e) =>
    e.evidence_source === "perimeter_topology.eave_edges"
  );
  assert(eaves.length >= 6);
  for (const e of eaves) {
    assertEquals(e.debug_only, true);
    assertEquals(e.validation_status, "candidate_only");
    assert(Array.isArray(e.start_geo) && Array.isArray(e.end_geo));
  }
});

Deno.test("does NOT require geo_to_dsm_transform or dsm_to_raster_transform", () => {
  const g = buildAerialCandidateGraph({
    rasterBoundsLatLng: {},
    geoToRasterTransform: {},
    perimeterTopology: fullTopo,
  });
  // No DSM-side transforms passed in at all.
  assertEquals(g.executed, true);
  assertEquals(g.evidence.dsm_required, false);
});

