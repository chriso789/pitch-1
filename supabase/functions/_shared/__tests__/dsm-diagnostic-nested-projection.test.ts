// dsm-diagnostic-nested-projection.test.ts
//
// The UI (MeasurementReportDialog) reads DSM diagnostics from
// registration.dsm.* and registration.stage_classifier.*. The runtime
// writes flat fields on registration root. Without a projection, the row
// renders "—" everywhere even when truth exists. This test pins the
// projection contract.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const { ensureDsmDiagnosticsOnRegistration } = await import(
  "../dsm-diagnostic-propagation.ts"
);

Deno.test(
  "registration.dsm.dsm_size_px is lifted from dsm_split_status when registration has no bounds",
  () => {
    const payload = {
      hard_fail_reason: "ai_measurement_cpu_timeout",
      geometry_report_json: {
        hard_fail_reason: "ai_measurement_cpu_timeout",
        failure_stage: "phase3_5_topology_cpu_budget_exceeded",
        dsm_split_status: {
          dsm_loaded: true,
          dsm_size_px: { width: 998, height: 998 },
        },
        registration: {
          confirmed_roof_center_lat_lng: { lat: 29.65, lng: -98.5 },
          dsm_tile_bounds_lat_lng: null,
          dsm_transform_policy_version: "dsm-transform-policy-v3",
          dsm_hoist_failure_tokens: ["dsm_bounds_missing"],
          stage_hard_fail_reason: "ai_measurement_cpu_timeout",
          stage_failure_stage: "phase3_5_topology_cpu_budget_exceeded",
        },
      },
    };

    const out = ensureDsmDiagnosticsOnRegistration(payload) as any;
    const reg = out.geometry_report_json.registration;

    // Nested dsm projection exists and the UI fields it reads are populated.
    assert(reg.dsm && typeof reg.dsm === "object", "registration.dsm exists");
    assertEquals(reg.dsm.dsm_size_px, { width: 998, height: 998 });
    assertEquals(
      reg.dsm.dsm_transform_policy_version,
      "dsm-transform-policy-v3",
    );
    assertEquals(reg.dsm.dsm_hoist_failure_tokens, ["dsm_bounds_missing"]);

    // Nested stage_classifier projection.
    assert(
      reg.stage_classifier && typeof reg.stage_classifier === "object",
      "registration.stage_classifier exists",
    );
    assertEquals(
      reg.stage_classifier.stage_hard_fail_reason,
      "ai_measurement_cpu_timeout",
    );
    assertEquals(
      reg.stage_classifier.stage_failure_stage,
      "phase3_5_topology_cpu_budget_exceeded",
    );
  },
);

Deno.test(
  "projection never overwrites a real nested dsm value",
  () => {
    const payload = {
      geometry_report_json: {
        dsm_split_status: { dsm_size_px: { width: 998, height: 998 } },
        registration: {
          dsm: {
            dsm_size_px: { width: 1280, height: 1280 },
            dsm_bounds_confidence: 0.9,
          },
          dsm_size_px: { width: 555, height: 555 },
        },
      },
    };
    const out = ensureDsmDiagnosticsOnRegistration(payload) as any;
    const reg = out.geometry_report_json.registration;
    assertEquals(reg.dsm.dsm_size_px, { width: 1280, height: 1280 });
    assertEquals(reg.dsm.dsm_bounds_confidence, 0.9);
  },
);

Deno.test(
  "stage_classifier falls back to geometry.hard_fail_reason when registration has none",
  () => {
    const payload = {
      geometry_report_json: {
        hard_fail_reason: "dsm_bounds_missing",
        failure_stage: "source_acquisition",
        registration: {
          confirmed_roof_center_lat_lng: { lat: 29.65, lng: -98.5 },
        },
      },
    };
    const out = ensureDsmDiagnosticsOnRegistration(payload) as any;
    const reg = out.geometry_report_json.registration;
    assertEquals(
      reg.stage_classifier.stage_hard_fail_reason,
      "dsm_bounds_missing",
    );
    assertEquals(
      reg.stage_classifier.stage_failure_stage,
      "source_acquisition",
    );
  },
);
