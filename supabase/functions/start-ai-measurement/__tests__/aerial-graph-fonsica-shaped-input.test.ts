// Fonsica-shaped input guarantees the aerial candidate graph executes.
// Regression for the registration-package hoist ordering bug where Phase 3A.5
// / autonomous-solver preempts persisted aerial_candidate_roof_graph with
// `executed=false, skipped_reason="raster_transform_unavailable"` even when
// the run had a valid transform package, raster bounds, perimeter ring, and
// eave edges.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAerialCandidateGraph } from "../../_shared/aerial-candidate-graph.ts";
import { buildPreTopologyDebugBag } from "../../_shared/pre-topology-debug-bag.ts";

// Fonsica-shaped perimeter (6-vertex complex hip with eave/perimeter edges).
const fonsicaPerimeterTopology = {
  perimeter_ring_px: [
    [200, 240],
    [620, 240],
    [620, 520],
    [440, 520],
    [440, 720],
    [200, 720],
  ],
  perimeter_ring_geo: [
    [-80.0000, 26.0000],
    [-79.9980, 26.0000],
    [-79.9980, 25.9985],
    [-79.9990, 25.9985],
    [-79.9990, 25.9975],
    [-80.0000, 25.9975],
  ],
  eave_edges: [
    { start_px: [200, 240], end_px: [620, 240], length_ft: 44, confidence: 0.92 },
    { start_px: [620, 240], end_px: [620, 520], length_ft: 30, confidence: 0.91 },
    { start_px: [620, 520], end_px: [440, 520], length_ft: 19, confidence: 0.90 },
    { start_px: [440, 520], end_px: [440, 720], length_ft: 22, confidence: 0.90 },
    { start_px: [440, 720], end_px: [200, 720], length_ft: 25, confidence: 0.91 },
    { start_px: [200, 720], end_px: [200, 240], length_ft: 51, confidence: 0.92 },
  ],
  perimeter_edges: [
    { start_px: [200, 240], end_px: [620, 240], length_ft: 44 },
    { start_px: [620, 240], end_px: [620, 520], length_ft: 30 },
    { start_px: [620, 520], end_px: [440, 520], length_ft: 19 },
    { start_px: [440, 520], end_px: [440, 720], length_ft: 22 },
    { start_px: [440, 720], end_px: [200, 720], length_ft: 25 },
    { start_px: [200, 720], end_px: [200, 240], length_ft: 51 },
  ],
};

const fonsicaTransformPackage = {
  raster_size_px: { width: 1280, height: 1280 },
  raster_bounds_lat_lng: {
    west: -80.0010,
    east: -79.9970,
    south: 25.9965,
    north: 26.0010,
  },
  geo_to_raster_transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  confirmed_roof_center_px: { x: 640, y: 480 },
  confirmed_roof_center_dsm_px: { x: 64, y: 48 },
  dsm_pixel_transform_valid: true,
  geo_to_dsm_px_success: true,
  dsm_tile_bounds_contain_confirmed_center: true,
};

Deno.test("Fonsica-shaped input: aerial graph executes with eave/perimeter edges", () => {
  const g = buildAerialCandidateGraph({
    rasterUrl: "https://example/fonsica.png",
    rasterBoundsLatLng: fonsicaTransformPackage.raster_bounds_lat_lng,
    geoToRasterTransform: fonsicaTransformPackage.geo_to_raster_transform,
    perimeterTopology: fonsicaPerimeterTopology,
    targetMaskIsolation: {
      checked: true,
      target_mask_area_sqft: 3077,
      perimeter_vs_mask_iou: 0.88,
    },
    registration: { transform_package: fonsicaTransformPackage },
  });

  assertEquals(g.executed, true, "Fonsica-shaped input must execute");
  assertEquals(g.skipped_reason, undefined);
  assert(g.edges.length >= 6, `expected >=6 edges, got ${g.edges.length}`);
  assertEquals(g.evidence.raster_registered, true);
  assertEquals(g.evidence.target_mask_isolation_checked, true);
});

Deno.test("Fonsica-shaped input via buildPreTopologyDebugBag: aerial graph executes", () => {
  const bag = buildPreTopologyDebugBag({
    stage: "autonomous_topology_solver",
    dsmGrid: { width: 128, height: 128, resolution: 0.1 },
    maskedDSM: { width: 128, height: 128, resolution: 0.1 },
    roofMask: { width: 128, height: 128 },
    raster: { width: 1280, height: 1280 },
    perimeterPhase0Snapshot: null,
    perimeterTopologySnapshot: fonsicaPerimeterTopology,
    targetMaskIsolation: { checked: true, target_mask_area_sqft: 3077 },
    footprintSource: "ai_validated",
    footprintGeo: fonsicaPerimeterTopology.perimeter_ring_geo as any,
    footprintPx: fonsicaPerimeterTopology.perimeter_ring_px as any,
    transformPackage: fonsicaTransformPackage,
    rasterBoundsLatLng: fonsicaTransformPackage.raster_bounds_lat_lng,
    geoToRasterTransform: fonsicaTransformPackage.geo_to_raster_transform,
    confirmedRoofCenterPx: fonsicaTransformPackage.confirmed_roof_center_px,
    rasterUrl: "https://example/fonsica.png",
  });

  const graph = bag.aerial_candidate_roof_graph!;
  assert(graph, "aerial_candidate_roof_graph must be present");
  assertEquals(graph.executed, true,
    `expected executed=true, got ${graph.executed} (skipped_reason=${graph.skipped_reason})`);
  assert(graph.edges.length >= 6, `expected >=6 edges, got ${graph.edges.length}`);
  assertNotEquals(graph.skipped_reason, "raster_transform_unavailable");
  assertEquals(bag.primary_geometry_source, "aerial_registered");
});

Deno.test("Skipped graph always carries skip_debug", () => {
  const g = buildAerialCandidateGraph({ perimeterTopology: fonsicaPerimeterTopology });
  assertEquals(g.executed, false);
  assertEquals(g.skipped_reason, "raster_transform_unavailable");
  assert(g.skip_debug, "skip_debug must be present on every skipped graph");
  assertEquals(g.skip_debug?.reason, "raster_transform_unavailable");
  assertEquals(g.skip_debug?.has_perimeter_ring_px, true);
  assertEquals(g.skip_debug?.has_geo_to_raster_transform, false);
});
