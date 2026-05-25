import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateAerialPrimacy } from "../../_shared/aerial-primary-gate.ts";

const ring = (n = 6) =>
  Array.from({ length: n }, (_, i) => [i, i] as [number, number]);

Deno.test("aerial-primary-gate: passes when all inputs present and IoU ≥ 0.75", () => {
  const r = evaluateAerialPrimacy({
    rasterUrl: "https://maps.googleapis.com/foo.png",
    geoToRasterTransform: { ax: 1, ay: 1 },
    perimeterTopologySnapshot: {
      perimeter_ring_px: ring(),
      perimeter_ring_geo: ring() as any,
      perimeter_vs_mask_iou: 0.82,
    },
    targetMaskIsolation: { perimeter_vs_mask_iou: 0.82 },
    footprintSource: "google_solar_mask_contour",
  });
  assertEquals(r.aerial_primary_ready, true);
  assertEquals(r.reasons.length, 0);
});

Deno.test("aerial-primary-gate: fails when footprint source is blocked", () => {
  const r = evaluateAerialPrimacy({
    rasterUrl: "https://x/y.png",
    geoToRasterTransform: { ax: 1 },
    perimeterTopologySnapshot: {
      perimeter_ring_px: ring(),
      perimeter_ring_geo: ring() as any,
      perimeter_vs_mask_iou: 0.9,
    },
    targetMaskIsolation: null,
    footprintSource: "blocked_by_registration_gate",
  });
  assertEquals(r.aerial_primary_ready, false);
  assert(r.reasons.includes("footprint_source_not_allowed"));
});

Deno.test("aerial-primary-gate: fails when IoU below threshold and no overlap rescue", () => {
  const r = evaluateAerialPrimacy({
    rasterUrl: "u",
    geoToRasterTransform: { x: 1 },
    perimeterTopologySnapshot: {
      perimeter_ring_px: ring(),
      perimeter_ring_geo: ring() as any,
      perimeter_vs_mask_iou: 0.5,
    },
    targetMaskIsolation: { perimeter_vs_mask_iou: 0.5 },
    footprintSource: "google_solar_mask_contour",
  });
  assertEquals(r.aerial_primary_ready, false);
  assert(r.reasons.includes("perimeter_vs_mask_iou_below_threshold"));
});

Deno.test("aerial-primary-gate: rescues IoU 0.70+ when overlap ≥ 0.95", () => {
  const r = evaluateAerialPrimacy({
    rasterUrl: "u",
    geoToRasterTransform: { x: 1 },
    perimeterTopologySnapshot: {
      perimeter_ring_px: ring(),
      perimeter_ring_geo: ring() as any,
      perimeter_vs_mask_iou: 0.72,
      target_mask_overlap_with_perimeter: 0.97,
    },
    targetMaskIsolation: null,
    footprintSource: "google_solar_mask_contour",
  });
  assertEquals(r.aerial_primary_ready, true);
});

Deno.test("aerial-primary-gate: fails when raster_url missing", () => {
  const r = evaluateAerialPrimacy({
    rasterUrl: null,
    geoToRasterTransform: { x: 1 },
    perimeterTopologySnapshot: {
      perimeter_ring_px: ring(),
      perimeter_ring_geo: ring() as any,
      perimeter_vs_mask_iou: 0.9,
    },
    targetMaskIsolation: null,
    footprintSource: "google_solar_mask_contour",
  });
  assertEquals(r.aerial_primary_ready, false);
  assert(r.reasons.includes("missing_raster_url"));
});

Deno.test("aerial-primary-gate: fails when perimeter ring too small", () => {
  const r = evaluateAerialPrimacy({
    rasterUrl: "u",
    geoToRasterTransform: { x: 1 },
    perimeterTopologySnapshot: {
      perimeter_ring_px: ring(3),
      perimeter_ring_geo: ring(3) as any,
      perimeter_vs_mask_iou: 0.9,
    },
    targetMaskIsolation: null,
    footprintSource: "google_solar_mask_contour",
  });
  assertEquals(r.aerial_primary_ready, false);
  assert(r.reasons.includes("perimeter_ring_px_too_small"));
});
