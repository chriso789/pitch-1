// Tests for DSM Candidate Registration Completion v1.
// Maps to "Add tests" section A–E in the user spec.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyRegistrationStage,
  REGISTRATION_STAGE_CLASSIFIER_VERSION,
} from "../registration-stage-classifier.ts";

const confirmedLL = { lat: 29.9, lng: -95.7 };
const rasterBounds = {
  sw: { lat: 29.899, lng: -95.701 },
  ne: { lat: 29.901, lng: -95.699 },
};
const dsmBounds = {
  sw: { lat: 29.899, lng: -95.701 },
  ne: { lat: 29.901, lng: -95.699 },
};

Deno.test("version stamp matches", () => {
  assertEquals(REGISTRATION_STAGE_CLASSIFIER_VERSION, "registration-stage-classifier-v1");
});

Deno.test("Test A — DSM bounds missing (static OK, DSM loaded but no bounds)", () => {
  const r = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: confirmedLL,
    confirmed_roof_center_px: [320, 320],
    raster_bounds_lat_lng: rasterBounds,
    raster_size_px: { width: 640, height: 640 },
    static_transform_succeeded: true,
    dsm: {
      dsm_url_present: true,
      dsm_loaded: true,
      dsm_decode_success: true,
      dsm_tile_bounds_lat_lng: null,
      dsm_size_px: null,
    },
    candidate: { selected_candidate_polygon_px: null },
  });
  assertEquals(r.hard_fail_reason, "dsm_bounds_missing");
  assertEquals(r.failure_stage, "dsm_bounds_extraction");
  // Static fields MUST NOT appear in missing_required_fields.
  assertEquals(r.missing_required_fields.includes("confirmed_roof_center_px"), false);
  assertEquals(r.missing_required_fields.includes("raster_bounds_lat_lng"), false);
  assertEquals(r.missing_required_fields.includes("dsm_tile_bounds_lat_lng"), true);
  assertEquals(r.dsm_proof.dsm_failure_reasons.includes("dsm_bounds_missing"), true);
});

Deno.test("Test B — DSM bounds valid; geo_to_dsm succeeds", () => {
  const r = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: confirmedLL,
    confirmed_roof_center_px: [320, 320],
    confirmed_roof_center_dsm_px: [128, 128],
    raster_bounds_lat_lng: rasterBounds,
    raster_size_px: { width: 640, height: 640 },
    static_transform_succeeded: true,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    dsm_tile_bounds_contain_confirmed_center: true,
    dsm_to_raster_bounds_overlap: true,
    dsm: {
      dsm_url_present: true,
      dsm_loaded: true,
      dsm_decode_success: true,
      dsm_bounds_source: "solar_data_layers_metadata",
      dsm_tile_bounds_lat_lng: dsmBounds,
      dsm_size_px: { width: 256, height: 256 },
    },
    candidate: {
      selected_candidate_polygon_px: [[100, 100], [200, 100], [200, 200], [100, 200]],
      candidate_coordinate_space: "dsm_px",
      candidate_source: "google_solar_mask",
    },
  });
  assertEquals(r.candidate_proof.confirmed_center_inside_candidate, true);
  // Centroid (150,150) → center (128,128) → offset ≈ 31.11
  assertEquals(Math.round(r.candidate_proof.candidate_centroid_offset_from_confirmed_center_px!), 31);
  assertEquals(r.missing_required_fields.includes("geo_to_dsm_transform"), false);
});

Deno.test("Test C — Candidate polygon missing", () => {
  const r = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: confirmedLL,
    confirmed_roof_center_px: [320, 320],
    confirmed_roof_center_dsm_px: [128, 128],
    raster_bounds_lat_lng: rasterBounds,
    static_transform_succeeded: true,
    geo_to_dsm_px_success: true,
    dsm_tile_bounds_contain_confirmed_center: true,
    dsm: {
      dsm_url_present: true,
      dsm_loaded: true,
      dsm_decode_success: true,
      dsm_tile_bounds_lat_lng: dsmBounds,
      dsm_size_px: { width: 256, height: 256 },
    },
    candidate: { selected_candidate_polygon_px: null },
  });
  assertEquals(r.hard_fail_reason, "candidate_polygon_missing");
  assertEquals(r.missing_required_fields.includes("selected_candidate_polygon_px"), true);
  assertEquals(r.missing_required_fields.includes("raster_bounds_lat_lng"), false);
});

Deno.test("Test D — Candidate coordinate-space mismatch", () => {
  const r = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: confirmedLL,
    confirmed_roof_center_px: [320, 320], // raster only
    confirmed_roof_center_dsm_px: null,
    static_transform_succeeded: true,
    dsm: {
      dsm_url_present: true,
      dsm_loaded: true,
      dsm_decode_success: true,
      dsm_tile_bounds_lat_lng: dsmBounds,
      dsm_size_px: { width: 256, height: 256 },
    },
    candidate: {
      // candidate in dsm_px space, but we only have raster center
      selected_candidate_polygon_px: [[10, 10], [20, 10], [20, 20], [10, 20]],
      candidate_coordinate_space: "dsm_px",
    },
  });
  assertEquals(r.hard_fail_reason, "coordinate_space_mismatch");
  assertEquals(r.coordinate_space_audit.mixed_space_detected, true);
  assertEquals(
    r.coordinate_space_audit.mixed_space_failure_reason,
    "candidate_polygon_in_dsm_px_but_only_raster_center_available",
  );
});

Deno.test("Test E — Candidate contains confirmed center (clean path)", () => {
  const r = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: confirmedLL,
    confirmed_roof_center_px: [150, 150],
    confirmed_roof_center_dsm_px: [150, 150],
    static_transform_succeeded: true,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    dsm_tile_bounds_contain_confirmed_center: true,
    dsm_to_raster_bounds_overlap: true,
    dsm: {
      dsm_url_present: true,
      dsm_loaded: true,
      dsm_decode_success: true,
      dsm_tile_bounds_lat_lng: dsmBounds,
      dsm_size_px: { width: 256, height: 256 },
    },
    candidate: {
      selected_candidate_polygon_px: [[100, 100], [200, 100], [200, 200], [100, 200]],
      candidate_coordinate_space: "dsm_px",
    },
  });
  assertEquals(r.candidate_proof.confirmed_center_inside_candidate, true);
  // No specific stage failure → falls back to generic
  assertEquals(r.hard_fail_reason, "coordinate_registration_failed");
  assertEquals(r.coordinate_space_audit.mixed_space_detected, false);
});

Deno.test("Test F — Candidate does not contain confirmed center", () => {
  const r = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: confirmedLL,
    confirmed_roof_center_px: [500, 500],
    confirmed_roof_center_dsm_px: [500, 500],
    static_transform_succeeded: true,
    geo_to_dsm_px_success: true,
    dsm_tile_bounds_contain_confirmed_center: true,
    dsm: {
      dsm_url_present: true,
      dsm_loaded: true,
      dsm_decode_success: true,
      dsm_tile_bounds_lat_lng: dsmBounds,
      dsm_size_px: { width: 256, height: 256 },
    },
    candidate: {
      selected_candidate_polygon_px: [[100, 100], [200, 100], [200, 200], [100, 200]],
      candidate_coordinate_space: "dsm_px",
    },
  });
  assertEquals(r.hard_fail_reason, "candidate_does_not_contain_confirmed_center");
  assertEquals(r.candidate_proof.confirmed_center_inside_candidate, false);
});

// ── Two-phase preflight ordering guard (Fonsica regression) ──
// Before this guard, an early-phase classifier call with no DSM evidence
// returned hard_fail_reason="dsm_bounds_missing", short-circuiting the run
// before Google Solar / DSM / mask were ever fetched.

Deno.test("Phase 1 — no DSM attempted → hard_fail_reason is null (early_preflight)", () => {
  const r = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: confirmedLL,
    confirmed_roof_center_px: [320, 320],
    raster_bounds_lat_lng: rasterBounds,
    static_transform_succeeded: true,
    // No DSM URL, not loaded, no transform success, no attempt flag.
    dsm: { dsm_url_present: false, dsm_loaded: false },
    candidate: { selected_candidate_polygon_px: null },
  });
  assertEquals(r.hard_fail_reason, null);
  assertEquals(r.failure_stage, "early_preflight");
  // No DSM-derived fields may appear in missing_required_fields.
  assertEquals(r.missing_required_fields.includes("dsm_tile_bounds_lat_lng"), false);
  assertEquals(r.missing_required_fields.includes("dsm_size_px"), false);
  assertEquals(r.missing_required_fields.includes("geo_to_dsm_transform"), false);
  assertEquals(r.missing_required_fields.includes("dsm_to_raster_transform"), false);
  assertEquals(r.missing_required_fields.includes("confirmed_roof_center_dsm_px"), false);
  assertEquals(r.missing_required_fields.includes("selected_candidate_polygon_px"), false);
});

Deno.test("Phase 1 — explicit dsm_fetch_attempted=false also returns null hard fail", () => {
  const r = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: confirmedLL,
    static_transform_succeeded: true,
    dsm_fetch_attempted: false,
    dsm: { dsm_url_present: false, dsm_loaded: false },
    candidate: { selected_candidate_polygon_px: null },
  } as any);
  assertEquals(r.hard_fail_reason, null);
  assertEquals(r.failure_stage, "early_preflight");
});

Deno.test("Phase 2 — dsm_fetch_attempted=true with bounds missing → dsm_bounds_missing", () => {
  const r = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: confirmedLL,
    confirmed_roof_center_px: [320, 320],
    raster_bounds_lat_lng: rasterBounds,
    static_transform_succeeded: true,
    dsm_fetch_attempted: true,
    dsm: {
      dsm_url_present: true,
      dsm_loaded: true,
      dsm_decode_success: true,
      dsm_tile_bounds_lat_lng: null,
      dsm_size_px: null,
    },
    candidate: { selected_candidate_polygon_px: null },
  } as any);
  assertEquals(r.hard_fail_reason, "dsm_bounds_missing");
  assertEquals(r.failure_stage, "dsm_bounds_extraction");
});

Deno.test("Phase 2 — dsm attempted but URL only, decode failed → dsm_decode_failed not silently early", () => {
  const r = classifyRegistrationStage({
    confirmed_roof_center_lat_lng: confirmedLL,
    static_transform_succeeded: true,
    dsm: {
      dsm_url_present: true,
      dsm_loaded: true,
      dsm_decode_success: false,
    },
    candidate: { selected_candidate_polygon_px: null },
  });
  // dsmAttempted=true via dsm_url_present, so classifier may emit hard fail.
  assertEquals(r.failure_stage === "early_preflight", false);
  assertEquals(r.hard_fail_reason, "dsm_decode_failed");
});
