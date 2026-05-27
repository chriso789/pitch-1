import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveFrameMismatch } from "../resolveFrameMismatch.ts";

Deno.test("priority 1: overlay_transform.frame_mismatch=ok wins", () => {
  const r = resolveFrameMismatch({
    overlay_transform: { frame_mismatch: "ok" },
    overlay_debug: { frame_mismatch: "mismatch" },
  });
  assertEquals(r.frame_mismatch_ok, true);
  assertEquals(r.frame_mismatch_source, "overlay_transform.frame_mismatch");
  assertEquals(r.frame_mismatch_raw, "ok");
});

Deno.test("explicit mismatch wins over later sources", () => {
  const r = resolveFrameMismatch({
    overlay_transform: { frame_mismatch: "raster_outside_dsm" },
    frame_mismatch: "ok",
  });
  assertEquals(r.frame_mismatch_ok, false);
  assertEquals(r.frame_mismatch_source, "overlay_transform.frame_mismatch");
});

Deno.test("registration.transform_package.frame_mismatch picked up", () => {
  const r = resolveFrameMismatch({
    registration: { transform_package: { frame_mismatch: "ok" } },
  });
  assertEquals(r.frame_mismatch_ok, true);
  assertEquals(
    r.frame_mismatch_source,
    "registration.transform_package.frame_mismatch",
  );
});

Deno.test("legacy dsmCoordinateMatchDebug fallback", () => {
  const r = resolveFrameMismatch({}, { frame_mismatch: "ok" });
  assertEquals(r.frame_mismatch_ok, true);
  assertEquals(r.frame_mismatch_source, "dsmCoordinateMatchDebug");
});

Deno.test("Fonsica-shaped inference: raster evidence complete -> ok", () => {
  const g = {
    coordinate_space_candidate: "raster_px",
    coordinate_space_renderer: "raster_px",
    source_raster_px: { width: 1280, height: 1280 },
    confirmed_roof_center_px: { x: 640, y: 640 },
    raster_bounds_contain_confirmed_center: true,
    selected_candidate_polygon_px_present: true,
    target_mask_overlap_with_perimeter: 0.976,
  };
  const r = resolveFrameMismatch(g);
  assertEquals(r.frame_mismatch_ok, true);
  assertEquals(
    r.frame_mismatch_source,
    "inferred_from_raster_registration_evidence",
  );
});

Deno.test("no explicit + weak evidence -> not ok", () => {
  const r = resolveFrameMismatch({
    coordinate_space_candidate: "raster_px",
    source_raster_px: { width: 1280, height: 1280 },
    target_mask_overlap_with_perimeter: 0.5,
  });
  assertEquals(r.frame_mismatch_ok, false);
  assertEquals(r.frame_mismatch_source, null);
});

Deno.test("live overlay evidence: nested registration.transform_package coordinate spaces + overlap >=0.9 -> ok", () => {
  const r = resolveFrameMismatch({
    registration: {
      transform_package: {
        coordinate_space_renderer: "raster_px",
        coordinate_space_candidate: "raster_px",
        raster_size_px: { width: 1280, height: 1280 },
      },
    },
    target_mask_isolation: {
      target_mask_overlap_with_perimeter: 0.976,
    },
  });
  assertEquals(r.frame_mismatch_ok, true);
  assertEquals(
    r.frame_mismatch_source,
    "inferred_from_live_overlay_transform_evidence",
  );
});
