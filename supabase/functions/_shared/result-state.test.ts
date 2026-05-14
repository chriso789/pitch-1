import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALLOWED_RESULT_STATES,
  isAllowedResultState,
  normalizeResultState,
  normalizeResultStateForWrite,
} from "./result-state.ts";

Deno.test("normalizeResultState: passes canonical values through", () => {
  for (const v of ALLOWED_RESULT_STATES) {
    assertEquals(normalizeResultState(v), v);
  }
});

Deno.test("normalizeResultState: maps perimeter failures", () => {
  assertEquals(normalizeResultState("perimeter_inner_trace_detected"), "ai_failed_perimeter");
  assertEquals(normalizeResultState("invalid_roof_footprint"), "ai_failed_perimeter");
  assertEquals(normalizeResultState("layer1_invalid"), "ai_failed_perimeter");
  assertEquals(normalizeResultState("target_mask_isolation_failed"), "ai_failed_perimeter");
});

Deno.test("normalizeResultState: maps target / source failures", () => {
  assertEquals(normalizeResultState("target_unconfirmed"), "ai_failed_target_unconfirmed");
  assertEquals(normalizeResultState("google_solar_no_dsm_coverage"), "ai_failed_source_acquisition");
  assertEquals(normalizeResultState("dsm_fetch_failed"), "ai_failed_source_acquisition");
  assertEquals(normalizeResultState("source_acquisition_failed"), "ai_failed_source_acquisition");
});

Deno.test("normalizeResultState: maps topology failures", () => {
  assertEquals(normalizeResultState("topology_undersegmented_after_refinement"), "ai_failed_topology");
  assertEquals(normalizeResultState("ai_failed_complex_topology"), "ai_failed_topology");
  assertEquals(normalizeResultState("invalid_edge_classification"), "ai_failed_topology");
  assertEquals(normalizeResultState("ridge_network_missing"), "ai_failed_topology");
});

Deno.test("normalizeResultState: maps pitch failures", () => {
  assertEquals(normalizeResultState("pitch_invalid"), "ai_failed_pitch");
  assertEquals(normalizeResultState("collapsed_plane_pitch"), "ai_failed_pitch");
});

Deno.test("normalizeResultState: maps schema failures", () => {
  assertEquals(normalizeResultState("schema_mismatch"), "ai_failed_schema");
  assertEquals(normalizeResultState("constraint_violation"), "ai_failed_schema");
});

Deno.test("normalizeResultState: unknown maps to ai_failed_unknown", () => {
  assertEquals(normalizeResultState("random_new_failure"), "ai_failed_unknown");
  assertEquals(normalizeResultState(null), "ai_failed_unknown");
  assertEquals(normalizeResultState(undefined), "ai_failed_unknown");
  assertEquals(normalizeResultState(""), "ai_failed_unknown");
});

Deno.test("normalizeResultStateForWrite: stamps forensic context for non-canonical input", () => {
  const grj: Record<string, any> = {};
  const out = normalizeResultStateForWrite("ai_failed_complex_topology", grj);
  assertEquals(out, "ai_failed_topology");
  assertEquals(grj.raw_result_state_attempted, "ai_failed_complex_topology");
  // ai_failed_complex_topology is non-canonical so this must be flagged.
  assertEquals(grj.result_state_normalization_error, true);
});

Deno.test("normalizeResultStateForWrite: leaves canonical input untouched", () => {
  const grj: Record<string, any> = {};
  const out = normalizeResultStateForWrite("perimeter_only", grj);
  assertEquals(out, "perimeter_only");
  assertEquals(grj.raw_result_state_attempted, undefined);
  assertEquals(grj.result_state_normalization_error, undefined);
});

Deno.test("isAllowedResultState only passes canonical values", () => {
  assert(isAllowedResultState("customer_report_ready"));
  assert(!isAllowedResultState("ai_failed_complex_topology"));
  assert(!isAllowedResultState("anything_else"));
});

Deno.test("integration: every normalized value is DB-safe", () => {
  const samples = [
    "perimeter_inner_trace_detected",
    "ai_failed_complex_topology",
    "google_solar_no_dsm_coverage",
    "collapsed_plane_pitch",
    "schema_violation",
    "totally_new_solver_failure",
    null,
    undefined,
    "",
    "READY",
  ];
  for (const s of samples) {
    const out = normalizeResultState(s);
    assert(
      (ALLOWED_RESULT_STATES as readonly string[]).includes(out),
      `normalized "${String(s)}" -> "${out}" must be in ALLOWED_RESULT_STATES`,
    );
  }
});
