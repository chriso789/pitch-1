/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveMeasurementDiagnosticState } from "./measurementDiagnosticState.ts";

Deno.test("viewer resolver shows runtime CPU failure instead of stale registration failure", () => {
  const resolved = resolveMeasurementDiagnosticState({
    result_state: "ai_failed_source_acquisition",
    hard_fail_reason: "dsm_bounds_missing",
    geometry_report_json: {
      result_state: "ai_failed_source_acquisition",
      hard_fail_reason: "dsm_bounds_missing",
      diagram_render_intent: "registration_blocked",
      footprint_source: "blocked_by_registration_gate",
      dsm_loaded: true,
      mask_loaded: true,
      dsm_planar_graph_debug: {
        result_state: "ai_failed_runtime",
        hard_fail_reason: "ai_measurement_cpu_timeout",
        failure_stage: "phase3_5_topology_cpu_budget_exceeded",
      },
    },
  });

  assertEquals(resolved.result_state, "ai_failed_runtime");
  assertEquals(resolved.hard_fail_reason, "ai_measurement_cpu_timeout");
  assertEquals(resolved.failure_stage, "phase3_5_topology_cpu_budget_exceeded");
  assertNotEquals(resolved.diagram_render_intent, "registration_blocked");
  assertNotEquals(resolved.footprint_source, "blocked_by_registration_gate");
});

Deno.test("viewer resolver does not mark confirmed roof target unconfirmed", () => {
  const resolved = resolveMeasurementDiagnosticState({
    user_confirmed_roof_target: true,
    geometry_report_json: {
      confirmed_roof_center_lat_lng: { lat: 40, lng: -75 },
    },
  });

  assertEquals(resolved.target_confirmation_passed, true);
});

Deno.test("viewer resolver keeps DSM loaded despite stale dsm_bounds_missing", () => {
  const resolved = resolveMeasurementDiagnosticState({
    geometry_report_json: {
      hard_fail_reason: "dsm_bounds_missing",
      dsm_loaded: true,
      registration: {
        dsm_size_px: { width: 998, height: 998 },
      },
    },
  });

  assertEquals(resolved.dsm_loaded, true);
});

Deno.test("viewer resolver labels Phase 0 as runtime-preempted", () => {
  const resolved = resolveMeasurementDiagnosticState({
    geometry_report_json: {
      dsm_loaded: true,
      mask_loaded: true,
      hard_fail_reason: "ai_measurement_cpu_timeout",
      cpu_budget_stage: "phase3_5_perimeter_refinement",
    },
  });

  assertEquals(resolved.phase0_incomplete_reason, "runtime_preemption");
});
