// PR A-2 — backend wire-up regression tests.
// Drives the pure decision functions in _shared/dsm-registration-stop-guard.ts
// against the Fonsica diagnostic fixture (DSM decoded, no tile bounds, raster
// candidate at center [640,640]).
//
// Acceptance:
//   - With DSM transform chain incomplete + raster perimeter editable → STOP
//     with result_state='perimeter_only', hard_fail_reason='dsm_registration_unavailable'.
//   - With full DSM transform chain → do NOT stop; solver may run.
//   - With raster_px candidate + confirmed_roof_center_px inside polygon →
//     raster_candidate_check_passed=true AND dsm_candidate_check_skipped=true
//     AND center_used_for_candidate_check='confirmed_roof_center_px'.
//   - DSM-space center comparison is NEVER attempted for raster_px candidates
//     (confirmed_center_inside_candidate_dsm stays null).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DSM_STOP_GUARD_VERSION,
  evaluateDsmRegistrationStopGuard,
  evaluateRasterCandidateCheck,
} from "../dsm-registration-stop-guard.ts";

import fonsica from "../__fixtures__/fonsica-dsm-missing.json" with {
  type: "json",
};

Deno.test("raster_candidate_check passes for Fonsica raster_px candidate at confirmed center", () => {
  const out = evaluateRasterCandidateCheck({
    selected_candidate_polygon_px: fonsica
      .selected_candidate_polygon_px as Array<[number, number]>,
    candidate_coordinate_space: fonsica.candidate_coordinate_space,
    confirmed_roof_center_px: fonsica.confirmed_roof_center_px as [
      number,
      number,
    ],
  });
  assertEquals(out.candidate_in_raster_px, true);
  assertEquals(out.raster_candidate_check_passed, true);
  assertEquals(out.dsm_candidate_check_skipped, true);
  assertEquals(out.center_used_for_candidate_check, "confirmed_roof_center_px");
  assertEquals(out.confirmed_center_inside_candidate_raster, true);
  // Hard contract: never derive a DSM-space inside flag when DSM is missing.
  assertEquals(out.confirmed_center_inside_candidate_dsm, null);
});

Deno.test("raster_candidate_check skips DSM comparison when candidate is dsm_px", () => {
  const out = evaluateRasterCandidateCheck({
    selected_candidate_polygon_px: fonsica
      .selected_candidate_polygon_px as Array<[number, number]>,
    candidate_coordinate_space: "dsm_px",
    confirmed_roof_center_px: fonsica.confirmed_roof_center_px as [
      number,
      number,
    ],
  });
  assertEquals(out.candidate_in_raster_px, false);
  // raster check does not apply
  assertEquals(out.raster_candidate_check_passed, false);
  assertEquals(out.center_used_for_candidate_check, null);
  assertEquals(out.confirmed_center_inside_candidate_dsm, null);
});

Deno.test("stop guard short-circuits Fonsica path: DSM chain incomplete + aerial editable → perimeter_only", () => {
  const dec = evaluateDsmRegistrationStopGuard({
    dsm_loaded: true,
    dsm_tile_bounds_lat_lng: fonsica.dsm_tile_bounds_lat_lng, // null in fixture
    geo_to_dsm_transform: null,
    dsm_to_raster_transform: null,
    dsm_pixel_transform_valid: false,
    raster_candidate_check_passed: true,
    candidate_in_raster_px: true,
    aerial_perimeter_editable: true,
  });
  assertEquals(dec.stop_before_autonomous_solver, true);
  assertEquals(dec.reason, "dsm_registration_unavailable");
  assertEquals(dec.result_state, "perimeter_only");
  assertEquals(dec.hard_fail_reason, "dsm_registration_unavailable");
  assertEquals(dec.block_customer_report_reason, "dsm_registration_unavailable");
  assertEquals(dec.diagram_render_intent, "perimeter_only");
  assertEquals(
    dec.dsm_registration_status,
    "unavailable_but_aerial_perimeter_editable",
  );
  assertEquals(dec.version, DSM_STOP_GUARD_VERSION);
});

Deno.test("stop guard returns ai_failed_source_acquisition when no aerial fallback", () => {
  const dec = evaluateDsmRegistrationStopGuard({
    dsm_loaded: true,
    dsm_tile_bounds_lat_lng: null,
    geo_to_dsm_transform: null,
    dsm_to_raster_transform: null,
    dsm_pixel_transform_valid: false,
    raster_candidate_check_passed: false,
    candidate_in_raster_px: false,
    aerial_perimeter_editable: false,
  });
  assertEquals(dec.stop_before_autonomous_solver, true);
  assertEquals(dec.reason, "stop_no_aerial_fallback");
  assertEquals(dec.result_state, "ai_failed_source_acquisition");
  assertEquals(dec.hard_fail_reason, "dsm_registration_unavailable");
  assertEquals(dec.diagram_render_intent, "rejected_only");
  assertEquals(
    dec.dsm_registration_status,
    "unavailable_no_aerial_fallback",
  );
});

Deno.test("stop guard does NOT short-circuit when DSM transform chain is complete", () => {
  const dec = evaluateDsmRegistrationStopGuard({
    dsm_loaded: true,
    dsm_tile_bounds_lat_lng: {
      sw: { lat: 27.041, lng: -82.2415 },
      ne: { lat: 27.0425, lng: -82.2398 },
    },
    geo_to_dsm_transform: { foo: "bar" },
    dsm_to_raster_transform: { foo: "bar" },
    dsm_pixel_transform_valid: true,
    raster_candidate_check_passed: true,
    candidate_in_raster_px: true,
    aerial_perimeter_editable: true,
  });
  assertEquals(dec.stop_before_autonomous_solver, false);
  assertEquals(dec.reason, "ok_to_run_solver");
  assertEquals(dec.dsm_registration_status, "available");
  assertEquals(dec.hard_fail_reason, null);
});

Deno.test("mixed-space failure CANNOT fire for raster_px candidate (no DSM-center comparison)", () => {
  // Regression for: mixed_space_failure_reason=
  //   'candidate_polygon_in_dsm_px_but_only_raster_center_available'.
  // For a raster_px candidate, the raster check is authoritative and the
  // DSM-side flag MUST remain null.
  const out = evaluateRasterCandidateCheck({
    selected_candidate_polygon_px: fonsica
      .selected_candidate_polygon_px as Array<[number, number]>,
    candidate_coordinate_space: "raster_px",
    confirmed_roof_center_px: fonsica.confirmed_roof_center_px as [
      number,
      number,
    ],
  });
  assertEquals(out.confirmed_center_inside_candidate_dsm, null);
  assertEquals(out.dsm_candidate_check_skipped, true);
  assert(out.raster_candidate_check_passed);
});

Deno.test("Fonsica centroid offset is sane (NOT the legacy 878px DSM-space artifact)", () => {
  // Sanity check: the raster polygon's bbox centroid vs the confirmed center
  // [640,640] must be small (well under the legacy 878px figure produced when
  // the gate erroneously compared raster_px polygons against DSM-space
  // centers).
  const poly = fonsica.selected_candidate_polygon_px as Array<
    [number, number]
  >;
  const center = fonsica.confirmed_roof_center_px as [number, number];
  let sx = 0, sy = 0;
  for (const [x, y] of poly) {
    sx += x;
    sy += y;
  }
  const cx = sx / poly.length;
  const cy = sy / poly.length;
  const dx = cx - center[0];
  const dy = cy - center[1];
  const offset = Math.sqrt(dx * dx + dy * dy);
  assert(
    offset < 100,
    `Fonsica centroid offset must be <100px in raster space; got ${offset}`,
  );
});
