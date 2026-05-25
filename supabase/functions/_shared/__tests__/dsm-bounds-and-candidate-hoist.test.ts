import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDsmRegistration } from "../dsm-registration.ts";
import { hoistSelectedCandidatePolygon } from "../candidate-hoist.ts";
import { classifyRegistrationStage } from "../registration-stage-classifier.ts";

const CENTER = { lat: 27.0820246, lng: -82.1962156 };

Deno.test("A: dsm_loaded + dsm_bbox → dsm_size_px populated, stage attempted", () => {
  const r = buildDsmRegistration({
    dsm_loaded: true,
    effectiveDSM: null,
    dsmCoordinateMatchDebug: { dsm_bbox: { width: 998, height: 998 } },
    confirmedCenterLatLng: CENTER,
    rasterMetersPerPixel: 0.15,
  });
  assertEquals(r.dsm_stage_attempted, true);
  assertEquals(r.dsm_stage_pending, false);
  assertEquals(r.dsm_size_px, { width: 998, height: 998 });
  assertEquals(r.dsm_size_source, "dsm_coordinate_match.dsm_bbox");
});

Deno.test("B: metadata missing → derived bounds from center+mpp", () => {
  const r = buildDsmRegistration({
    dsm_loaded: true,
    effectiveDSM: { width: 998, height: 998, bounds: null, resolution: 0.1 },
    confirmedCenterLatLng: CENTER,
  });
  assert(r.dsm_tile_bounds_lat_lng !== null);
  assertEquals(r.dsm_bounds_source, "derived_from_confirmed_center_and_mpp");
  assertEquals(r.dsm_bounds_derived, true);
  assertEquals(r.dsm_bounds_warning, "derived_bounds_lower_confidence");
});

Deno.test("C: hoist falls back to raw footprint when no candidate table", () => {
  const r = hoistSelectedCandidatePolygon({
    fallback_footprint_px: [[0,0],[10,0],[10,10],[0,10]],
    fallback_footprint_source: "google_solar_mask_contour",
    default_coordinate_space: "dsm_px",
  });
  assertEquals(r.candidate_hoist_origin, "fallback_footprint");
  assertEquals(r.candidate_coordinate_space, "dsm_px");
  assertEquals(r.selected_candidate_polygon_point_count, 4);
});

Deno.test("D: hoist prefers perimeter_candidate_table.selected", () => {
  const r = hoistSelectedCandidatePolygon({
    perimeter_candidate_table: [
      { id: "a", selected: false, ring_px: [[0,0],[1,0],[1,1]] },
      { id: "b", selected: true, source: "comp_1", ring_px: [[5,5],[15,5],[15,15],[5,15]], coordinate_space: "dsm_px", area_sqft: 1234 },
    ],
    fallback_footprint_px: [[0,0],[1,0],[1,1]],
  });
  assertEquals(r.candidate_hoist_origin, "perimeter_candidate_table");
  assertEquals(r.candidate_source, "comp_1");
  assertEquals(r.candidate_area_sqft, 1234);
});

Deno.test("E: classifier reports candidate_centroid_offset_exceeds_target", () => {
  const poly = [[100,100],[110,100],[110,110],[100,110]] as [number,number][];
  const rep = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: CENTER,
    confirmed_roof_center_px: [640, 640],
    confirmed_roof_center_dsm_px: [640, 640],
    raster_bounds_lat_lng: { sw: { lat: 27.08, lng: -82.20 }, ne: { lat: 27.09, lng: -82.19 } },
    static_transform_succeeded: true,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    dsm_tile_bounds_contain_confirmed_center: true,
    dsm_to_raster_bounds_overlap: true,
    dsm: {
      dsm_url_present: true, dsm_loaded: true, dsm_decode_success: true,
      dsm_bounds_source: "google_solar_metadata",
      dsm_tile_bounds_lat_lng: { sw: { lat: 27.08, lng: -82.20 }, ne: { lat: 27.09, lng: -82.19 } },
      dsm_size_px: { width: 998, height: 998 },
      dsm_meters_per_pixel: 0.1,
    },
    candidate: {
      selected_candidate_polygon_px: poly,
      candidate_coordinate_space: "dsm_px",
      candidate_source: "google_solar_mask_contour:component_2",
      candidate_centroid_offset_threshold_px: 100,
    },
  });
  assertEquals(rep.hard_fail_reason, "candidate_centroid_offset_exceeds_target");
});

Deno.test("D2: center used for candidate check uses dsm_px space", () => {
  const poly = [[630,630],[650,630],[650,650],[630,650]] as [number,number][];
  const rep = classifyRegistrationStage({
    confirmed_roof_center_px: [10, 10],
    confirmed_roof_center_dsm_px: [640, 640],
    raster_bounds_lat_lng: { sw: { lat: 27, lng: -82.2 }, ne: { lat: 27.01, lng: -82.19 } },
    static_transform_succeeded: true,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    dsm_tile_bounds_contain_confirmed_center: true,
    dsm_to_raster_bounds_overlap: true,
    dsm: {
      dsm_url_present: true, dsm_loaded: true, dsm_decode_success: true,
      dsm_bounds_source: "google_solar_metadata",
      dsm_tile_bounds_lat_lng: { sw: { lat: 27, lng: -82.2 }, ne: { lat: 27.01, lng: -82.19 } },
      dsm_size_px: { width: 998, height: 998 },
      dsm_meters_per_pixel: 0.1,
    },
    candidate: {
      selected_candidate_polygon_px: poly,
      candidate_coordinate_space: "dsm_px",
      candidate_centroid_offset_threshold_px: 100,
    },
  });
  assertEquals(rep.coordinate_space_audit.center_used_for_candidate_check, "dsm_px");
  assertEquals(rep.candidate_proof.confirmed_center_inside_candidate, true);
});
