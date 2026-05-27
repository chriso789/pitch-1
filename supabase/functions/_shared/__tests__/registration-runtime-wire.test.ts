// Registration runtime wire — consolidated regression proof.
//
// This file is the single "did the wiring survive?" entry point for the
// AI Measurement registration-prep code path. It exercises the pure
// surfaces that start-ai-measurement composes at runtime:
//
//   buildDsmRegistration          → DSM size hoist + bounds derivation
//   hoistSelectedCandidatePolygon → candidate hoist (Test C)
//   evaluateRegistrationGate      → coordinate-space + offset checks (D/E/F)
//   quarantine helpers            → stale-payload quarantine (Test G)
//   normalizeResultStateForWrite  → result_state contract sweep
//
// Granular coverage of each surface lives in sibling test files
// (transform-runtime-wiring, dsm-bounds-and-candidate-hoist, aerial-graph-*,
// cpu-preempt-threshold). This file adds the missing Test G + the
// result_state contract sweep, and is the proof we re-read when chasing a
// Fonsica-class runtime-shape regression.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildDsmRegistration } from "../dsm-registration.ts";
import { hoistSelectedCandidatePolygon } from "../candidate-hoist.ts";
import { evaluateRegistrationGate } from "../registration-gate.ts";
import {
  forceRegistrationBlockedPhaseBlocks,
  quarantineRegistrationBlockedVisibleGeometry,
  REGISTRATION_BLOCKED_SKIPPED_REASON,
  stripRegistrationBlockedGeometryArtifacts,
} from "../registration-precedence.ts";
import {
  ALLOWED_RESULT_STATES,
  normalizeResultStateForWrite,
} from "../result-state.ts";

const FONSICA = { lat: 27.9506, lng: -82.4572 };
const FONSICA_BOUNDS = {
  sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
  ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
};

// ─── Test A — DSM size hoist from dsm_coordinate_match.dsm_bbox ─────────────
Deno.test("A — dsm_loaded + dsm_bbox → dsm_size_px populated from match bbox", () => {
  const r = buildDsmRegistration({
    dsm_loaded: true,
    effectiveDSM: null,
    dsmCoordinateMatchDebug: { dsm_bbox: { width: 998, height: 998 } },
    confirmedCenterLatLng: FONSICA,
    rasterMetersPerPixel: 0.15,
  });
  assertEquals(r.dsm_stage_attempted, true);
  assertEquals(r.dsm_stage_pending, false);
  assertEquals(r.dsm_size_px, { width: 998, height: 998 });
  assertEquals(r.dsm_size_source, "dsm_coordinate_match.dsm_bbox");
  assertNotEquals(
    r.failure_tokens.includes("coordinate_registration_failed"),
    true,
    "must never emit generic coordinate_registration_failed",
  );
});

// ─── Test B — Bounds derivation OR specific dsm_bounds_missing ──────────────
Deno.test("B — no metadata bounds → derived from center+mpp OR dsm_bounds_missing (never generic)", () => {
  const derived = buildDsmRegistration({
    dsm_loaded: true,
    effectiveDSM: { width: 998, height: 998, bounds: null, resolution: 0.1 },
    confirmedCenterLatLng: FONSICA,
    allow_derived_bounds: true,
  });
  assert(derived.dsm_tile_bounds_lat_lng, "bounds should be derived");
  assertEquals(derived.dsm_bounds_source, "derived_from_confirmed_center_and_mpp");
  assertEquals(derived.dsm_bounds_derived, true);
  assertEquals(derived.dsm_bounds_warning, "derived_bounds_lower_confidence");

  const noMpp = buildDsmRegistration({
    dsm_loaded: true,
    effectiveDSM: null,
    dsmCoordinateMatchDebug: { dsm_bbox: { width: 998, height: 998 } },
    // no confirmed center, no raster mpp → cannot derive
  });
  assertEquals(noMpp.dsm_tile_bounds_lat_lng, null);
  assert(
    noMpp.failure_tokens.includes("dsm_bounds_missing"),
    "must emit specific dsm_bounds_missing, not generic coordinate_registration_failed",
  );
  assertNotEquals(
    noMpp.failure_tokens.includes("coordinate_registration_failed"),
    true,
  );
});

// ─── Test C — Candidate hoist from perimeter_topology.perimeter_ring_px ─────
Deno.test("C — candidate hoist populates selected_candidate_polygon_px from current run", () => {
  const r = hoistSelectedCandidatePolygon({
    fallback_footprint_px: [[10, 10], [110, 10], [110, 110], [10, 110]],
    fallback_footprint_source: "perimeter_topology.perimeter_ring_px",
    default_coordinate_space: "raster_px",
  });
  assertEquals(r.candidate_hoist_origin, "fallback_footprint");
  assertEquals(r.candidate_coordinate_space, "raster_px");
  assertEquals(r.selected_candidate_polygon_point_count, 4);
  assert(r.selected_candidate_polygon_px, "polygon must be populated");
});

// ─── Test D — Coordinate space dsm_px ──────────────────────────────────────
Deno.test("D — dsm_px candidate → center_used_for_candidate_check === dsm_px", () => {
  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: [10, 10],
    confirmed_roof_center_dsm_px: [640, 640],
    geo_to_raster_transform: {},
    geo_to_dsm_transform: {},
    dsm_to_raster_transform: {},
    raster_bounds_lat_lng: FONSICA_BOUNDS,
    dsm_tile_bounds_lat_lng: FONSICA_BOUNDS,
    dsm_size_px: { width: 998, height: 998 },
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    selected_candidate_polygon_px: [[630, 630], [650, 630], [650, 650], [630, 650]],
    candidate_coordinate_space: "dsm_px",
    footprint_bbox_diagonal_px: 40,
  });
  assertEquals(
    (result.registration as any).center_used_for_candidate_check,
    "dsm_px",
  );
  assertEquals(result.confirmed_center_inside_candidate, true);
});

// ─── Test E — Coordinate space raster_px ───────────────────────────────────
Deno.test("E — raster_px candidate → center_used_for_candidate_check === raster_px", () => {
  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: [640, 640],
    confirmed_roof_center_dsm_px: [10, 10],
    geo_to_raster_transform: {},
    geo_to_dsm_transform: {},
    dsm_to_raster_transform: {},
    raster_bounds_lat_lng: FONSICA_BOUNDS,
    dsm_tile_bounds_lat_lng: FONSICA_BOUNDS,
    dsm_size_px: { width: 998, height: 998 },
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    selected_candidate_polygon_px: [[630, 630], [650, 630], [650, 650], [630, 650]],
    candidate_coordinate_space: "raster_px",
    footprint_bbox_diagonal_px: 40,
  });
  assertEquals(
    (result.registration as any).center_used_for_candidate_check,
    "raster_px",
  );
  assertEquals(result.confirmed_center_inside_candidate, true);
});

// ─── Test F — Far-offset candidate rejected with specific token ────────────
Deno.test("F — 878px offset → candidate_centroid_offset_exceeds_target (not generic)", () => {
  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: [640, 640],
    confirmed_roof_center_dsm_px: [640, 640],
    geo_to_raster_transform: {},
    geo_to_dsm_transform: {},
    dsm_to_raster_transform: {},
    raster_bounds_lat_lng: FONSICA_BOUNDS,
    dsm_tile_bounds_lat_lng: FONSICA_BOUNDS,
    dsm_size_px: { width: 998, height: 998 },
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    // candidate centroid sits ~878px from confirmed center (the Fonsica bug).
    selected_candidate_polygon_px: [[100, 100], [120, 100], [120, 120], [100, 120]],
    candidate_coordinate_space: "raster_px",
    footprint_bbox_diagonal_px: 40,
  });
  assertEquals(
    result.failure?.hard_fail_reason,
    "candidate_centroid_offset_exceeds_target",
  );
  assertNotEquals(
    result.failure?.hard_fail_reason,
    "coordinate_registration_failed",
  );
  assertEquals(
    (result.registration as any).candidate_rejection_reason,
    "centroid_offset_exceeds_target",
  );
});

// ─── Test G — Stale-payload quarantine + phase blocks blocked ──────────────
Deno.test("G — registration block quarantines stale perimeter/topology + zeroes visible report", () => {
  // Simulated geometry as it would look mid-pipeline just before the block.
  const geometry: Record<string, unknown> = {
    perimeter_topology: { perimeter_ring_px: [[1, 1], [2, 2]] },
    perimeter_phase0: { something: true },
    perimeter_gate_metrics: { passed: true },
    perimeter_inner_trace: [1, 2, 3],
    selected_perimeter_after_refinement: "label",
    debug_perimeter_overlay_svg: "<svg/>",
    roof_lines: [{ attribute: "eave", length_ft: 10 }],
    roof_lines_count: 12,
    reportable_roof_lines_count: 12,
    roof_lines_by_attribute: { eave: 6, ridge: 2 },
    roof_line_total_lf_by_attribute: { eave: 120 },
    phase3B_active: true,
    phase3B: { version: "v1", executed: true, roof_lines_count: 12 },
    phase3_5: { version: "v1", executed: true },
    phase3C: { version: "v1", executed: true },
    phase3D: { version: "v1", executed: true },
    phase3E: { version: "v1", executed: true },
    footprint_source: "google_solar_mask_contour",
  };

  // Apply quarantine pipeline as start-ai-measurement does on registration block.
  stripRegistrationBlockedGeometryArtifacts(geometry as any);
  quarantineRegistrationBlockedVisibleGeometry(geometry as any);
  forceRegistrationBlockedPhaseBlocks(geometry as any);
  (geometry as any).footprint_source = "blocked_by_registration_gate";
  (geometry as any).diagram_render_intent = "registration_blocked";

  // Stale debug bucket carries the original phase3B payload.
  const stale = (geometry as any).stale_debug_payload as Record<string, unknown>;
  assert(stale, "stale_debug_payload must exist");
  assert(stale.phase3B, "stale.phase3B must capture pre-block phase3B fields");

  // Visible report is zeroed.
  assertEquals((geometry as any).roof_lines, []);
  assertEquals((geometry as any).roof_lines_count, 0);
  assertEquals((geometry as any).reportable_roof_lines_count, 0);
  assertEquals((geometry as any).phase3B_active, false);
  assertEquals((geometry as any).phase3B.executed, false);
  assertEquals((geometry as any).phase3B.skipped_reason, REGISTRATION_BLOCKED_SKIPPED_REASON);

  // Debug-only perimeter artifacts removed from visible geometry.
  assertEquals((geometry as any).perimeter_phase0, undefined);
  assertEquals((geometry as any).perimeter_gate_metrics, undefined);
  assertEquals((geometry as any).perimeter_inner_trace, undefined);
  assertEquals((geometry as any).selected_perimeter_after_refinement, undefined);
  assertEquals((geometry as any).debug_perimeter_overlay_svg, undefined);

  // Phase blocks all stamped blocked_by_registration_gate.
  for (const k of ["phase3_5", "phase3C", "phase3D", "phase3E"] as const) {
    assertEquals((geometry as any)[k].executed, false, `${k}.executed`);
    assertEquals(
      (geometry as any)[k].skipped_reason,
      REGISTRATION_BLOCKED_SKIPPED_REASON,
      `${k}.skipped_reason`,
    );
  }

  // Final render contract.
  assertEquals((geometry as any).footprint_source, "blocked_by_registration_gate");
  assertEquals((geometry as any).diagram_render_intent, "registration_blocked");
});

// ─── Result-state contract sweep ───────────────────────────────────────────
Deno.test("Result-state contract: specific solver tokens normalize into canonical buckets, never expand the enum", () => {
  const specificTokens = [
    "dsm_bounds_missing",
    "dsm_size_missing",
    "selected_candidate_polygon_missing",
    "coordinate_space_mismatch",
    "candidate_centroid_offset_exceeds_target",
    "candidate_does_not_contain_confirmed_center",
    "no_perimeter_candidate_contains_confirmed_center",
    "geo_to_dsm_transform_missing",
    "dsm_to_raster_transform_missing",
    "ai_measurement_cpu_timeout",
    "coordinate_registration_failed",
  ];
  for (const tok of specificTokens) {
    const normalized = normalizeResultStateForWrite(tok);
    assert(
      (ALLOWED_RESULT_STATES as readonly string[]).includes(normalized),
      `normalized result_state "${normalized}" for token "${tok}" must be in canonical bucket list`,
    );
    // Hard rule: specific solver tokens must NEVER pass through as a raw
    // result_state. They land on hard_fail_reason; result_state stays bucketed.
    assertNotEquals(
      normalized,
      tok,
      `token "${tok}" must be mapped, not stored verbatim as result_state`,
    );
  }
});

Deno.test("Result-state contract: every canonical bucket round-trips through normalizer", () => {
  for (const bucket of ALLOWED_RESULT_STATES) {
    assertEquals(normalizeResultStateForWrite(bucket), bucket);
  }
});
