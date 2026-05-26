// dsm-diagnostic-propagation.test.ts
//
// Asserts that the new DSM registration diagnostic fields written onto
// `geometry_report_json.registration` by start-ai-measurement's
// applyLiveRuntimeHoistToRegistration are projected through
// `summarizeRow` -> registration.dsm / registration.stage_classifier
// without mutation.

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// The module under test instantiates a Supabase client at import time. Stub
// the required env vars so the import succeeds in the test runner — these
// tests never touch the network, they only call the pure summarizeRow().
Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://localhost");
Deno.env.set(
  "SUPABASE_SERVICE_ROLE_KEY",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "test-service-role-key",
);
Deno.env.set(
  "SUPABASE_ANON_KEY",
  Deno.env.get("SUPABASE_ANON_KEY") ?? "test-anon-key",
);

const { summarizeRow } = await import("../index.ts");

const BASE_REG_BOUNDS_MISSING = {
  version: "registration-v2.3",
  user_confirmed_roof_target: true,
  original_geocode_lat_lng: { lat: 29.65, lng: -98.5 },
  confirmed_roof_center_lat_lng: { lat: 29.6501, lng: -98.5001 },
  confirmed_roof_center_px: [640, 640],

  // DSM was loaded but Google Solar metadata did not include tiepoints
  dsm_stage_attempted: true,
  dsm_stage_pending: false,
  dsm_size_px: { width: 998, height: 998 },
  dsm_size_source: "geotiff_decoded",
  dsm_tile_bounds_lat_lng: null,
  dsm_bounds_source: null,
  dsm_tile_bounds_source: null,
  dsm_tile_bounds_failure_reason: "geotiff_missing_tiepoints",
  dsm_bounds_derived: false,
  dsm_bounds_warning: null,
  dsm_bounds_confidence: null,
  dsm_meters_per_pixel: null,
  dsm_mpp_source: null,
  dsm_registration_version: "dsm-registration-v3",
  dsm_registration_source: "google_solar_data_layers",
  dsm_hoist_called: true,
  dsm_hoist_callsite: "start-ai-measurement",
  dsm_hoist_version: "dsm-hoist-v1",
  dsm_hoist_failure_tokens: [
    "dsm_tile_bounds_missing_from_google_solar_metadata",
  ],

  // transforms unbuildable without bounds, but raster-center fallback ran
  geo_to_dsm_transform: null,
  geo_to_dsm_transform_source: null,
  dsm_to_raster_transform: null,
  dsm_to_raster_transform_source: null,
  confirmed_roof_center_dsm_px: [499, 499],
  confirmed_roof_center_dsm_px_source: "derived_from_raster_center",
  dsm_transform_policy_version: "dsm-registration-transform-v1",
  geo_to_dsm_px_success: false,
  dsm_pixel_transform_valid: false,
  dsm_tile_bounds_contain_confirmed_center: false,
  dsm_raster_bounds_overlap: false,
  dsm_raster_overlap_ratio: 0,

  // candidate stage didn't run for a usable centroid
  confirmed_center_inside_candidate: null,
  coordinate_registration_gate_passed: false,

  // classifier output written by start-ai-measurement
  stage_hard_fail_reason: "dsm_tile_bounds_missing_from_google_solar_metadata",
  stage_failure_stage: "dsm_registration",
  coordinate_space_audit: {
    center_used_for_candidate_check: "confirmed_roof_center_px",
  },
  candidate_rejection_reason: null,
};

function makeRow(reg: Record<string, unknown>) {
  return {
    id: "row-fonsica-test",
    created_at: "2026-05-26T00:00:00Z",
    lead_id: "lead-1",
    tenant_id: "tenant-1",
    created_by_function: "start-ai-measurement",
    canonical_measurement_route: true,
    result_state: "ai_failed_source_acquisition",
    customer_report_ready: false,
    geometry_report_json: { registration: reg },
  };
}

Deno.test(
  "summarizeRow surfaces DSM source/policy/failure diagnostics when bounds missing",
  () => {
    const out = summarizeRow(makeRow(BASE_REG_BOUNDS_MISSING));

    // (1) registration block present
    assertEquals(out.registration.present, true);

    // (2-3) DSM size projected, bounds null
    assertEquals((out.registration.dsm as any).dsm_size_px, {
      width: 998,
      height: 998,
    });
    assertEquals((out.registration.dsm as any).dsm_tile_bounds_lat_lng, null);

    // (4) explicit failure reason from registration-v3
    assertEquals(
      (out.registration.dsm as any).dsm_tile_bounds_failure_reason,
      "geotiff_missing_tiepoints",
    );

    // (5) bounds source still null (no derivation in this prompt)
    assertEquals((out.registration.dsm as any).dsm_bounds_source, null);
    assertEquals((out.registration.dsm as any).dsm_tile_bounds_source, null);

    // (6) hoist failure tokens surfaced
    assertExists((out.registration.dsm as any).dsm_hoist_failure_tokens);
    const tokens = (out.registration.dsm as any).dsm_hoist_failure_tokens as string[];
    assertEquals(
      tokens.includes("dsm_tile_bounds_missing_from_google_solar_metadata"),
      true,
    );

    // (7) transform policy version surfaced
    assertEquals(
      (out.registration.dsm as any).dsm_transform_policy_version,
      "dsm-registration-transform-v1",
    );

    // (8) raster-center fallback source surfaced
    assertEquals(
      (out.registration.dsm as any).confirmed_roof_center_dsm_px_source,
      "derived_from_raster_center",
    );

    // (9) classifier hard fail surfaced
    assertEquals(
      (out.registration.stage_classifier as any).stage_hard_fail_reason,
      "dsm_tile_bounds_missing_from_google_solar_metadata",
    );
    assertEquals(
      (out.registration.stage_classifier as any).stage_failure_stage,
      "dsm_registration",
    );

    // (10) honest false on the transform validity flag
    assertEquals(out.registration.dsm_pixel_transform_valid, false);

    // (11) manual approval still blocked
    assertEquals(out.manual_approval_allowed, false);

    // (12) top-level row contract unchanged
    assertEquals(out.customer_report_ready, false);
    assertEquals(out.result_state, "ai_failed_source_acquisition");
  },
);

Deno.test(
  "summarizeRow surfaces success-side DSM source tags when bounds present",
  () => {
    const reg = {
      ...BASE_REG_BOUNDS_MISSING,
      dsm_tile_bounds_lat_lng: {
        sw: { lat: 29.6495, lng: -98.5008 },
        ne: { lat: 29.6508, lng: -98.4994 },
      },
      dsm_bounds_source: "geotiff_tiepoint",
      dsm_tile_bounds_source: "geotiff_tiepoint",
      dsm_tile_bounds_failure_reason: null,
      dsm_meters_per_pixel: 0.12,
      dsm_mpp_source: "geotiff_pixel_scale",
      geo_to_dsm_transform: { a: 1 },
      geo_to_dsm_transform_source: "computed_from_bounds",
      dsm_to_raster_transform: { a: 1 },
      dsm_to_raster_transform_source: "computed_from_bounds",
      confirmed_roof_center_dsm_px_source: "computed_from_geo",
      geo_to_dsm_px_success: true,
      dsm_pixel_transform_valid: true,
      dsm_tile_bounds_contain_confirmed_center: true,
      dsm_raster_bounds_overlap: true,
      dsm_raster_overlap_ratio: 0.97,
      dsm_hoist_failure_tokens: [],
      stage_hard_fail_reason: null,
      stage_failure_stage: "topology",
    };

    const out = summarizeRow(makeRow(reg));

    assertEquals(
      (out.registration.dsm as any).dsm_tile_bounds_source,
      "geotiff_tiepoint",
    );
    assertEquals(
      (out.registration.dsm as any).geo_to_dsm_transform_source,
      "computed_from_bounds",
    );
    assertEquals(
      (out.registration.dsm as any).dsm_to_raster_transform_source,
      "computed_from_bounds",
    );
    assertEquals(
      (out.registration.dsm as any).confirmed_roof_center_dsm_px_source,
      "computed_from_geo",
    );
    assertEquals(
      (out.registration.dsm as any).dsm_transform_policy_version,
      "dsm-registration-transform-v1",
    );
    assertEquals((out.registration.dsm as any).dsm_tile_bounds_failure_reason, null);
    assertEquals(
      ((out.registration.dsm as any).dsm_hoist_failure_tokens as string[]).length,
      0,
    );
    assertEquals(out.registration.dsm_pixel_transform_valid, true);
    assertEquals(
      (out.registration.stage_classifier as any).stage_hard_fail_reason,
      null,
    );

    // dsm-truth phase fails honest at topology now; customer still not ready
    // (we don't promote anything from this read-side projection)
    assertEquals(out.customer_report_ready, false);
  },
);

Deno.test(
  "summarizeRow returns null dsm/stage_classifier when registration absent",
  () => {
    const out = summarizeRow({
      id: "row-none",
      created_at: "2026-05-26T00:00:00Z",
      geometry_report_json: {},
    });
    assertEquals(out.registration.present, false);
    assertEquals(out.registration.dsm, null);
    assertEquals(out.registration.stage_classifier, null);
  },
);
