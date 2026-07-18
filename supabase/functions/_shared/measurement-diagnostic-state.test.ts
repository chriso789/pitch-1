import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveMeasurementDiagnosticState } from "./measurement-diagnostic-state.ts";

Deno.test("runtime precedence overrides stale registration/source-acquisition failure", () => {
  const resolved = resolveMeasurementDiagnosticState({
    result_state: "ai_failed_source_acquisition",
    hard_fail_reason: "dsm_bounds_missing",
    geometry_report_json: {
      result_state: "ai_failed_source_acquisition",
      hard_fail_reason: "dsm_bounds_missing",
      block_customer_report_reason: "dsm_bounds_missing",
      diagram_render_intent: "registration_blocked",
      footprint_source: "blocked_by_registration_gate",
      dsm_loaded: true,
      mask_loaded: true,
      dsm_planar_graph_debug: {
        result_state: "ai_failed_runtime",
        hard_fail_reason: "ai_measurement_cpu_timeout",
        failure_stage: "phase3_5_topology_cpu_budget_exceeded",
        cpu_budget_preempt_reason:
          "estimated_topology_workload_exceeds_cpu_budget",
      },
      overlay_debug: {
        hard_fail_reason: "ai_measurement_cpu_timeout",
      },
    },
  });

  assertEquals(resolved.result_state, "ai_failed_runtime");
  assertEquals(resolved.hard_fail_reason, "ai_measurement_cpu_timeout");
  assertEquals(resolved.failure_stage, "phase3_5_topology_cpu_budget_exceeded");
  assertNotEquals(resolved.diagram_render_intent, "registration_blocked");
  assertEquals(resolved.final_state_source, "runtime_cpu_budget_guard");
  assertEquals(resolved.source_acquisition_completed, true);
});

Deno.test("target confirmation passes when user confirmed target and center exists", () => {
  const resolved = resolveMeasurementDiagnosticState({
    user_confirmed_roof_target: true,
    geometry_report_json: {
      confirmed_roof_center_lat_lng: { lat: 40, lng: -75 },
    },
  });

  assertEquals(resolved.target_confirmation_passed, true);
});

Deno.test("DSM loaded label is not failed solely because stale dsm_bounds_missing exists", () => {
  const resolved = resolveMeasurementDiagnosticState({
    geometry_report_json: {
      hard_fail_reason: "dsm_bounds_missing",
      registration: {
        dsm_size_px: { width: 998, height: 998 },
      },
      dsm_loaded: true,
    },
  });

  assertEquals(resolved.dsm_loaded, true);
});

Deno.test("CPU preemption marks Phase 0 incomplete due to runtime preemption", () => {
  const resolved = resolveMeasurementDiagnosticState({
    geometry_report_json: {
      dsm_loaded: true,
      mask_loaded: true,
      cpu_budget_stage: "phase3_5_perimeter_refinement",
      hard_fail_reason: "ai_measurement_cpu_timeout",
    },
  });

  assertEquals(resolved.phase0_incomplete_reason, "runtime_preemption");
  assertEquals(resolved.hard_fail_reason, "ai_measurement_cpu_timeout");
});

Deno.test("DSM registration unavailable outranks stale dsm_bounds_missing when aerial perimeter is editable", () => {
  const resolved = resolveMeasurementDiagnosticState({
    result_state: "ai_failed_source_acquisition",
    hard_fail_reason: "dsm_bounds_missing",
    geometry_report_json: {
      result_state: "ai_failed_source_acquisition",
      hard_fail_reason: "dsm_bounds_missing",
      block_customer_report_reason: "dsm_bounds_missing",
      failure_stage: "source_registration",
      dsm_loaded: true,
      mask_loaded: true,
      dsm_registration_status: "unavailable_but_aerial_perimeter_editable",
      raster_candidate_check_passed: true,
      footprint_px: [[100, 100], [500, 100], [500, 500], [100, 500]],
      dsm_stop_guard: {
        reason: "dsm_registration_unavailable",
        hard_fail_reason: "dsm_registration_unavailable",
        dsm_registration_status: "unavailable_but_aerial_perimeter_editable",
        diagnostics: {
          raster_candidate_check_passed: true,
          aerial_perimeter_editable: true,
        },
      },
    },
  });

  assertEquals(resolved.result_state, "perimeter_only");
  assertEquals(resolved.hard_fail_reason, "dsm_registration_unavailable");
  assertEquals(resolved.block_customer_report_reason, "dsm_registration_unavailable");
  assertEquals(resolved.failure_stage, "dsm_registration");
  assertEquals(resolved.diagram_render_intent, "perimeter_only");
  assertEquals(resolved.final_state_source, "dsm_registration_unavailable_guard");
  assertEquals(resolved.customer_report_ready, false);
});

Deno.test("derived DSM bounds evidence prevents stale dsm_bounds_missing from being final state", () => {
  const resolved = resolveMeasurementDiagnosticState({
    result_state: "ai_failed_source_acquisition",
    hard_fail_reason: "dsm_bounds_missing",
    geometry_report_json: {
      hard_fail_reason: "dsm_bounds_missing",
      block_customer_report_reason: "dsm_bounds_missing",
      dsm_loaded: true,
      mask_loaded: true,
      raster_candidate_check_passed: true,
      footprint_px: [[100, 100], [500, 100], [500, 500], [100, 500]],
      dsm_coordinate_match: {
        dsm_bbox: {
          bounds: {
            sw: { lat: 27.081, lng: -82.197 },
            ne: { lat: 27.083, lng: -82.195 },
          },
          resolution: 0.1,
        },
      },
    },
  });

  assertEquals(resolved.result_state, "perimeter_only");
  assertEquals(resolved.hard_fail_reason, "dsm_registration_unavailable");
  assertEquals(resolved.final_state_source, "dsm_registration_unavailable_guard");
});
