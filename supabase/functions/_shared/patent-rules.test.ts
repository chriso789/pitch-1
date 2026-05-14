import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyLayer1, requireLayer1 } from "./layer-model.ts";
import { aggregateLineTotalsByAttribute, buildRoofLine } from "./roof-lines.ts";
import { assertCustomerReportReady } from "./measurement-gates.ts";

Deno.test("layer-model: forbidden source rejected", () => {
  const l1 = classifyLayer1("solar_segment_bbox", [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 },
  ]);
  assertEquals(l1.is_valid, false);
  assertEquals(l1.forbidden_source_rejected_reasons[0], "forbidden_source:solar_segment_bbox");
});

Deno.test("layer-model: allowed eave source passes", () => {
  const l1 = classifyLayer1("eave", [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 },
  ]);
  assertEquals(l1.is_valid, true);
});

Deno.test("layer-model: requireLayer1 throws on invalid", () => {
  const l1 = classifyLayer1("global_mask_bbox", [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  let threw = false;
  try { requireLayer1(l1); } catch { threw = true; }
  assertEquals(threw, true);
});

Deno.test("roof-lines: only customer-reportable typed lines aggregate", () => {
  const lines = [
    buildRoofLine({ id: "1", measurement_id: "m", layer_id: "layer2_structural",
      geometry_px: [[0,0],[10,0]], length_lf: 10, non_dimensional_attribute: "ridge",
      source: "dsm", confidence: 0.9, adjacent_plane_ids: [] }),
    buildRoofLine({ id: "2", measurement_id: "m", layer_id: "layer2_structural",
      geometry_px: [[0,0],[5,0]], length_lf: 5, non_dimensional_attribute: "unknown",
      source: "inferred", confidence: 0.2, adjacent_plane_ids: [] }),
  ];
  const t = aggregateLineTotalsByAttribute(lines);
  assertEquals(t.ridges_lf, 10);
  assertEquals(t.unknown_lf, 5);
});

Deno.test("measurement-gates: target unconfirmed blocks", () => {
  const r = assertCustomerReportReady({
    user_confirmed_roof_target: false,
    layer1_present: true, layer1_source_allowed: true,
    roof_lines_count: 5, reportable_totals_have_typed_backing: true,
    per_plane_pitch_sources: ["perimeter_ridge"], ai_gates_passed: true,
  });
  assertEquals(r.ready, false);
  assertEquals(r.block_customer_report_reason, "target_unconfirmed");
});

Deno.test("measurement-gates: collapsed pitch blocks", () => {
  const r = assertCustomerReportReady({
    user_confirmed_roof_target: true,
    layer1_present: true, layer1_source_allowed: true,
    roof_lines_count: 5, reportable_totals_have_typed_backing: true,
    per_plane_pitch_sources: ["perimeter_ridge", "collapsed_plane_fit"],
    ai_gates_passed: true,
  });
  assertEquals(r.ready, false);
  assertEquals(r.failures.some((f) => f.startsWith("collapsed_plane_pitch")), true);
});

Deno.test("measurement-gates: validated overrides bypass ai_failed", () => {
  const r = assertCustomerReportReady({
    user_confirmed_roof_target: true,
    layer1_present: true, layer1_source_allowed: true,
    roof_lines_count: 5, reportable_totals_have_typed_backing: true,
    per_plane_pitch_sources: ["perimeter_ridge"], ai_gates_passed: false,
    override_validation_status: "passed",
  });
  assertEquals(r.ready, true);
});
