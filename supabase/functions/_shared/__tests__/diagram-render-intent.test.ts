import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeDiagramRenderIntentForWrite,
  isDiagramRenderIntentConstraintError,
  STABLE_DIAGRAM_RENDER_INTENTS,
  withDiagramRenderIntentConstraintRetryPayload,
} from "../diagram-render-intent.ts";

Deno.test("registration_blocked passes through", () => {
  const r = normalizeDiagramRenderIntentForWrite("registration_blocked");
  assertEquals(r.normalized, "registration_blocked");
  assertEquals(r.drifted, false);
});

Deno.test("perimeter_debug_only passes through", () => {
  const r = normalizeDiagramRenderIntentForWrite("perimeter_debug_only");
  assertEquals(r.normalized, "perimeter_debug_only");
});

Deno.test("coordinate_registration_failed → registration_blocked", () => {
  const r = normalizeDiagramRenderIntentForWrite("coordinate_registration_failed");
  assertEquals(r.normalized, "registration_blocked");
});

Deno.test("coordinate_registration_debug_only → registration_blocked", () => {
  const r = normalizeDiagramRenderIntentForWrite("coordinate_registration_debug_only");
  assertEquals(r.normalized, "registration_blocked");
});

Deno.test("visual_perimeter_alignment_failed → perimeter_debug_only", () => {
  const r = normalizeDiagramRenderIntentForWrite("visual_perimeter_alignment_failed");
  assertEquals(r.normalized, "perimeter_debug_only");
});

Deno.test("perimeter_shape_not_accurate → perimeter_debug_only", () => {
  const r = normalizeDiagramRenderIntentForWrite("perimeter_shape_not_accurate");
  assertEquals(r.normalized, "perimeter_debug_only");
});

Deno.test("ai_failed_source_acquisition with registration failure context → registration_blocked", () => {
  const r = normalizeDiagramRenderIntentForWrite("ai_failed_source_acquisition", {
    result_state: "ai_failed_source_acquisition",
    hard_fail_reason: "coordinate_registration_failed",
  });
  assertEquals(r.normalized, "registration_blocked");
});

Deno.test("target_confirmation_required → registration_blocked", () => {
  const r = normalizeDiagramRenderIntentForWrite("target_confirmation_required");
  assertEquals(r.normalized, "registration_blocked");
});

Deno.test("unknown value → diagnostic_only with warning", () => {
  const r = normalizeDiagramRenderIntentForWrite("some_brand_new_intent");
  assertEquals(r.normalized, "diagnostic_only");
  assertEquals(r.drifted, true);
  assert(r.warning && r.warning.includes("some_brand_new_intent"));
});

Deno.test("null/undefined → diagnostic_only without warning", () => {
  assertEquals(normalizeDiagramRenderIntentForWrite(null).normalized, "diagnostic_only");
  assertEquals(normalizeDiagramRenderIntentForWrite(undefined).normalized, "diagnostic_only");
});

Deno.test("all stable buckets normalize to themselves", () => {
  for (const v of STABLE_DIAGRAM_RENDER_INTENTS) {
    assertEquals(normalizeDiagramRenderIntentForWrite(v).normalized, v);
  }
});

Deno.test("isDiagramRenderIntentConstraintError detects PG 23514", () => {
  assert(
    isDiagramRenderIntentConstraintError({
      code: "23514",
      message: 'new row violates check constraint "roof_measurements_diagram_render_intent_check"',
    }),
  );
  assert(!isDiagramRenderIntentConstraintError({ code: "23505", message: "duplicate key" }));
});

Deno.test("insert retry payload preserves diagnostics and coerces diagram intent", () => {
  const payload = withDiagramRenderIntentConstraintRetryPayload({
    diagram_render_intent: "coordinate_registration_debug_only",
    geometry_report_json: { existing: true },
  });
  assertEquals(payload.diagram_render_intent, "diagnostic_only");
  assertEquals((payload.geometry_report_json as any).existing, true);
  assertEquals((payload.geometry_report_json as any).insert_retry, {
    reason: "diagram_render_intent_check_violation",
    raw_diagram_render_intent: "coordinate_registration_debug_only",
    retried_with: "diagnostic_only",
  });
  assertEquals((payload.geometry_report_json as any).raw_diagram_render_intent, "coordinate_registration_debug_only");
  assertEquals((payload.geometry_report_json as any).normalized_diagram_render_intent, "diagnostic_only");
});
