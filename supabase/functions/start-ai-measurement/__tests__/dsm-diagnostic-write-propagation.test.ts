// dsm-diagnostic-write-propagation.test.ts
//
// Write-side companion to debug-measurement-runtime/dsm-diagnostic-propagation.
// Verifies that every persisted payload going through
// ensureRegistrationProofBeforeWrite emerges with the new DSM diagnostic
// fields materialized on geometry_report_json.registration — even when DSM
// bounds are genuinely missing. This stops the live row from rendering
// "field-absent" where the runtime has answers.

import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://localhost");
Deno.env.set(
  "SUPABASE_SERVICE_ROLE_KEY",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "test-service-role-key",
);
Deno.env.set(
  "SUPABASE_ANON_KEY",
  Deno.env.get("SUPABASE_ANON_KEY") ?? "test-anon-key",
);

const { ensureDsmDiagnosticsOnRegistration } = await import("../index.ts");

const DIAGNOSTIC_FIELDS = [
  "dsm_tile_bounds_source",
  "dsm_tile_bounds_failure_reason",
  "dsm_bounds_source",
  "dsm_bounds_derived",
  "dsm_bounds_warning",
  "dsm_bounds_confidence",
  "dsm_meters_per_pixel",
  "dsm_mpp_source",
  "dsm_size_source",
  "dsm_hoist_called",
  "dsm_hoist_callsite",
  "dsm_hoist_version",
  "dsm_hoist_failure_tokens",
  "dsm_stage_attempted",
  "dsm_stage_pending",
  "dsm_registration_version",
  "dsm_registration_source",
];

Deno.test(
  "ensureDsmDiagnosticsOnRegistration materializes all diagnostic fields on a legacy bounds-missing payload",
  () => {
    const payload = {
      result_state: "ai_failed_source_acquisition",
      customer_report_ready: false,
      geometry_report_json: {
        dsm_split_status: {
          dsm_loaded: true,
          mask_loaded: true,
          raster_loaded: true,
          dsm_size_px: { width: 998, height: 998 },
        },
        registration: {
          // legacy shape — no diagnostic fields at all
          confirmed_roof_center_lat_lng: { lat: 29.65, lng: -98.5 },
          dsm_tile_bounds_lat_lng: null,
        },
      },
    };

    const out = ensureDsmDiagnosticsOnRegistration(payload) as any;
    const reg = out.geometry_report_json.registration;

    // Every field is present (even if null) — no field-absent shape.
    for (const f of DIAGNOSTIC_FIELDS) {
      assert(f in reg, `expected field ${f} to be present on registration`);
    }

    // Bounds are unchanged (still null — we do not derive in this prompt).
    assertEquals(reg.dsm_tile_bounds_lat_lng, null);

    // Propagation stamps are present and versioned.
    assertEquals(
      reg.dsm_diagnostic_propagation_version,
      "dsm-diagnostic-propagation-v1",
    );
    assertExists(reg.dsm_diagnostic_propagation_at);
    assertExists(reg.dsm_diagnostic_propagation_summary);

    // Mirror lifted from geometry to registration.
    assertEquals(reg.dsm_split_status.dsm_size_px, {
      width: 998,
      height: 998,
    });

    // Top-level row contract unchanged.
    assertEquals(out.customer_report_ready, false);
    assertEquals(out.result_state, "ai_failed_source_acquisition");
  },
);

Deno.test(
  "ensureDsmDiagnosticsOnRegistration is idempotent and never overwrites real values",
  () => {
    const payload = {
      geometry_report_json: {
        registration: {
          confirmed_roof_center_lat_lng: { lat: 29.65, lng: -98.5 },
          dsm_tile_bounds_lat_lng: {
            sw: { lat: 29.6495, lng: -98.5008 },
            ne: { lat: 29.6508, lng: -98.4994 },
          },
          dsm_tile_bounds_source: "geotiff_tiepoint",
          dsm_bounds_source: "geotiff_tiepoint",
          dsm_bounds_derived: false,
          dsm_bounds_confidence: 1.0,
          dsm_meters_per_pixel: 0.12,
          dsm_mpp_source: "decoded_dsm_grid",
          dsm_hoist_failure_tokens: [],
          dsm_hoist_called: true,
          dsm_hoist_callsite: "start-ai-measurement",
          dsm_hoist_version: "dsm-hoist-v1",
          dsm_stage_attempted: true,
          dsm_stage_pending: false,
        },
      },
    };

    const out1 = ensureDsmDiagnosticsOnRegistration(payload) as any;
    const out2 = ensureDsmDiagnosticsOnRegistration(out1) as any;
    const reg1 = out1.geometry_report_json.registration;
    const reg2 = out2.geometry_report_json.registration;

    // Real values preserved.
    assertEquals(reg1.dsm_tile_bounds_source, "geotiff_tiepoint");
    assertEquals(reg1.dsm_bounds_confidence, 1.0);
    assertEquals(reg1.dsm_meters_per_pixel, 0.12);

    // Summary reflects bounds present.
    assertEquals(reg1.dsm_diagnostic_propagation_summary, "bounds_present");

    // Second pass does not mutate substantive fields.
    assertEquals(reg2.dsm_tile_bounds_source, reg1.dsm_tile_bounds_source);
    assertEquals(reg2.dsm_bounds_confidence, reg1.dsm_bounds_confidence);
    assertEquals(reg2.dsm_meters_per_pixel, reg1.dsm_meters_per_pixel);
    assertEquals(
      reg2.dsm_diagnostic_propagation_summary,
      reg1.dsm_diagnostic_propagation_summary,
    );
    assertEquals(
      reg2.dsm_diagnostic_propagation_version,
      reg1.dsm_diagnostic_propagation_version,
    );
  },
);

Deno.test(
  "ensureDsmDiagnosticsOnRegistration surfaces a reason summary for missing bounds",
  () => {
    const payload = {
      geometry_report_json: {
        registration: {
          dsm_tile_bounds_lat_lng: null,
          dsm_hoist_failure_tokens: [
            "dsm_tile_bounds_missing_from_google_solar_metadata",
          ],
          dsm_stage_attempted: true,
          dsm_stage_pending: false,
        },
      },
    };
    const out = ensureDsmDiagnosticsOnRegistration(payload) as any;
    const reg = out.geometry_report_json.registration;
    assertEquals(
      reg.dsm_diagnostic_propagation_summary,
      "google_solar_tile_bounds_missing",
    );
  },
);

Deno.test(
  "ensureDsmDiagnosticsOnRegistration is a no-op when geometry_report_json is absent",
  () => {
    const payload = { result_state: "ai_failed_source_acquisition" };
    const out = ensureDsmDiagnosticsOnRegistration(payload) as any;
    assertEquals(out.result_state, "ai_failed_source_acquisition");
    assertEquals(out.geometry_report_json, undefined);
  },
);
