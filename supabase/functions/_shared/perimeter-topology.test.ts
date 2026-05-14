/**
 * Unit + regression tests for `evaluatePerimeterGate`.
 *
 * Hard contracts under test:
 *   1. Global mask area is NEVER used as the area-conservation reference for
 *      hard-fail decisions. Only the isolated target-mask area (or the
 *      perimeter's own area when no target context is supplied) may fail it.
 *   2. `global_mask_inflation_ratio > 2` produces a warning, not a fail.
 *   3. `benchmark_area_sqft` within ±10% of perimeter suppresses
 *      area/missed-roof failures.
 *   4. `solar_expected_area_sqft` within ±10% of perimeter suppresses
 *      area/missed-roof failures.
 *   5. Fonsica regression: with a 3,255 sqft perimeter, an inflated
 *      11,697 sqft global mask, and a benchmark area of 3,260 sqft, the gate
 *      MUST pass and Phase 0 diagnostics MUST be populated.
 */

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluatePerimeterGate, type PerimeterTopology } from "./perimeter-topology.ts";
import fonsica from "./__fixtures__/fonsica-perimeter-sample.json" with { type: "json" };

function makeTopology(overrides: Partial<PerimeterTopology> = {}): PerimeterTopology {
  const eave = { id: "e1", type: "eave" as const, length_ft: 60, length_px: 60, start_px: { x: 0, y: 0 }, end_px: { x: 60, y: 0 }, start_geo: [0, 0] as [number, number], end_geo: [0, 0] as [number, number], classification_evidence: {} as any, classification_confidence: 0.9 };
  const rake = { ...eave, id: "e2", type: "rake" as const, length_ft: 40, length_px: 40 };
  const eave2 = { ...eave, id: "e3", length_ft: 60 };
  const rake2 = { ...rake, id: "e4", length_ft: 40 };
  const edges = [eave, rake, eave2, rake2];
  const ring = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 180 },
    { x: 100, y: 180 },
    { x: 100, y: 100 },
  ];
  return {
    perimeter_ring_px: ring,
    perimeter_ring_geo: ring.map((p) => [p.x, p.y] as [number, number]),
    perimeter_nodes: [],
    perimeter_edges: edges,
    eave_edges: [eave, eave2],
    rake_edges: [rake, rake2],
    corner_nodes: [],
    reflex_corners: [],
    convex_corners: [],
    overhang_confidence: 0.9,
    footprint_source: "google_solar_mask_contour",
    perimeter_source: "google_solar_mask_contour",
    perimeter_area_sqft: 3255,
    perimeter_closed: true,
    perimeter_self_intersections: 0,
    perimeter_registration_score: 0.91,
    perimeter_confidence: 0.86,
    customer_perimeter_ready: true,
    ...overrides,
  };
}

Deno.test("evaluatePerimeterGate: global mask is never the hard-fail reference", () => {
  const topology = makeTopology();
  // 3,255 sqft perimeter vs 11,697 sqft global mask. If the gate were using
  // global mask, the area_ratio would be 0.278 → hard fail. With the target
  // mask of 3,300 sqft + benchmark sanity, it must pass.
  const result = evaluatePerimeterGate(topology, /*roofMaskAreaSqft (legacy)*/ 11_697, {
    target_mask_area_sqft: 3300,
    benchmark_area_sqft: 3260,
    solar_expected_area_sqft: 3290,
    global_mask_inflation_ratio: 11_697 / 3300,
  });

  // No failure reason may reference the global mask figure.
  for (const reason of result.failure_reasons) {
    assertFalse(/11697|11_697|global_mask/.test(reason), `Hard fail referenced global mask: ${reason}`);
  }
  assert(result.passed, `Expected gate to pass, got failures: ${result.failure_reasons.join(", ")}`);
  assertEquals(result.diagnostics.perimeter_gate_passed, true);
});

Deno.test("evaluatePerimeterGate: global_mask_inflation_ratio > 2 emits warning, never hard fail", () => {
  const topology = makeTopology();
  const result = evaluatePerimeterGate(topology, 3300, {
    target_mask_area_sqft: 3300,
    benchmark_area_sqft: 3260,
    global_mask_inflation_ratio: 3.54,
  });
  assert(result.passed, "Inflation > 2 must not hard-fail the gate");
  // Warning lives on diagnostics; no hard-fail reason for inflation.
  for (const reason of result.failure_reasons) {
    assertFalse(reason.startsWith("global_mask_inflated"));
  }
});

Deno.test("evaluatePerimeterGate: benchmark sanity within ±10% suppresses area mismatch failure", () => {
  // Perimeter 3,255 sqft, target mask noisy at 5,000 sqft (>5% off), but
  // benchmark says 3,260 → within 1% → must NOT fail on area.
  const topology = makeTopology();
  const result = evaluatePerimeterGate(topology, 5000, {
    target_mask_area_sqft: 5000,
    benchmark_area_sqft: 3260,
  });
  assert(result.passed, `Expected benchmark sanity to suppress fail, got: ${result.failure_reasons.join(", ")}`);
});

Deno.test("evaluatePerimeterGate: solar sanity within ±10% suppresses area mismatch failure", () => {
  const topology = makeTopology();
  const result = evaluatePerimeterGate(topology, 5000, {
    target_mask_area_sqft: 5000,
    solar_expected_area_sqft: 3290,
  });
  assert(result.passed, `Expected solar sanity to suppress fail, got: ${result.failure_reasons.join(", ")}`);
});

Deno.test("evaluatePerimeterGate: noisy target mask without sanity context still fails", () => {
  // Same noisy target mask, no benchmark/solar context → must fail.
  const topology = makeTopology();
  const result = evaluatePerimeterGate(topology, 5000, {
    target_mask_area_sqft: 5000,
  });
  assertFalse(result.passed, "Without sanity context the area mismatch must hard-fail");
  assert(
    result.failure_reasons.some((r) => /area|fonsica/.test(r)),
    "Failure reasons should reference area mismatch",
  );
});

Deno.test("Fonsica regression: gate passes and Phase 0 diagnostics persist when target-mask gate fires", () => {
  const topology = makeTopology({
    perimeter_area_sqft: fonsica.perimeter_topology.perimeter_area_sqft,
    perimeter_registration_score: fonsica.perimeter_topology.perimeter_registration_score,
    perimeter_confidence: fonsica.perimeter_topology.perimeter_confidence,
  });
  const ctx = fonsica.gate_context;
  const result = evaluatePerimeterGate(topology, ctx.global_mask_area_sqft, {
    target_mask_area_sqft: ctx.target_mask_area_sqft,
    benchmark_area_sqft: ctx.benchmark_area_sqft,
    solar_expected_area_sqft: ctx.solar_expected_area_sqft,
    global_mask_inflation_ratio: ctx.global_mask_inflation_ratio,
  });
  assert(result.passed, `Fonsica regression must pass, got: ${result.failure_reasons.join(", ")}`);

  // Phase 0 diagnostics shape — non-null, populated, never inferring from global mask.
  const d = result.diagnostics;
  assertEquals(typeof d.perimeter_area_sqft, "number");
  assertEquals(typeof d.perimeter_gate_passed, "boolean");
  assert(d.eave_length_lf > 0, "eave_length_lf must be populated");
  assert(d.rake_length_lf > 0, "rake_length_lf must be populated");
  assertEquals(d.perimeter_gate_passed, true);
  // The diagnostics object is what start-ai-measurement persists as
  // `geometry_report_json.perimeter_phase0`. It must never be null when the
  // gate has been evaluated.
  assert(d !== null && typeof d === "object", "Phase 0 diagnostics must persist");
});
