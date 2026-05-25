// Regression: roof_measurements_footprint_source_check DB CHECK constraint.
//
// The DB column accepts only the values in ALLOWED_FOOTPRINT_SOURCES.
// Diagnostic labels ("blocked_by_registration_gate",
// "google_solar_roof_mask", etc.) used to land directly in the column,
// exploding the insert with a 23514 error and collapsing the entire
// diagnostic chain into processJob_outer_catch.
//
// This test pins the normalizer + the chokepoint coercion so any future
// regression that re-introduces a raw diagnostic value is caught here.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALLOWED_FOOTPRINT_SOURCES,
  applyFootprintSourceDbSafeCoercion,
  normalizeRoofMeasurementFootprintSource,
} from "../../_shared/footprint-source.ts";

Deno.test("normalizer coerces 'blocked_by_registration_gate' to 'unknown'", () => {
  assertEquals(
    normalizeRoofMeasurementFootprintSource("blocked_by_registration_gate"),
    "unknown",
  );
});

Deno.test("normalizer coerces 'google_solar_roof_mask' to 'google_solar_api'", () => {
  assertEquals(
    normalizeRoofMeasurementFootprintSource("google_solar_roof_mask"),
    "google_solar_api",
  );
});

Deno.test("normalizer coerces other diagnostic labels to DB-safe values", () => {
  for (
    const raw of [
      "registration_blocked",
      "coordinate_registration_failed",
      "coordinate_registration_blocked",
      "runtime_preempted",
    ]
  ) {
    const out = normalizeRoofMeasurementFootprintSource(raw);
    assert(
      ALLOWED_FOOTPRINT_SOURCES.has(out),
      `expected '${raw}' to coerce to a whitelisted value, got '${out}'`,
    );
  }
});

Deno.test("every allowed value round-trips", () => {
  for (const v of ALLOWED_FOOTPRINT_SOURCES) {
    assertEquals(normalizeRoofMeasurementFootprintSource(v), v);
  }
});

Deno.test("null / undefined / empty coerce to 'unknown'", () => {
  assertEquals(
    normalizeRoofMeasurementFootprintSource(null as unknown as string),
    "unknown",
  );
  assertEquals(
    normalizeRoofMeasurementFootprintSource(undefined as unknown as string),
    "unknown",
  );
  assertEquals(normalizeRoofMeasurementFootprintSource(""), "unknown");
});

Deno.test("chokepoint coercion: rewrites payload + stashes diagnostic on geometry", () => {
  const payload: Record<string, unknown> = {
    footprint_source: "blocked_by_registration_gate",
  };
  const geometry: Record<string, unknown> = {};

  const result = applyFootprintSourceDbSafeCoercion(payload, geometry);

  assertEquals(result.coerced, true);
  assertEquals(result.raw, "blocked_by_registration_gate");
  assertEquals(result.normalized, "unknown");
  assertEquals(payload.footprint_source, "unknown");
  assertEquals(geometry.footprint_source, "unknown");
  assertEquals(
    geometry.footprint_source_diagnostic,
    "blocked_by_registration_gate",
  );
  assertEquals(
    geometry.footprint_source_normalized_from,
    "blocked_by_registration_gate",
  );
  assertEquals(geometry.footprint_source_normalized_to, "unknown");
});

Deno.test("chokepoint coercion: google_solar_roof_mask preserved as diagnostic", () => {
  const payload: Record<string, unknown> = {
    footprint_source: "google_solar_roof_mask",
  };
  const geometry: Record<string, unknown> = {};
  applyFootprintSourceDbSafeCoercion(payload, geometry);
  assertEquals(payload.footprint_source, "google_solar_api");
  assertEquals(
    geometry.footprint_source_diagnostic,
    "google_solar_roof_mask",
  );
});

Deno.test("chokepoint coercion: already-valid value passes through unchanged", () => {
  const payload: Record<string, unknown> = {
    footprint_source: "regrid_parcel",
  };
  const geometry: Record<string, unknown> = {};
  const result = applyFootprintSourceDbSafeCoercion(payload, geometry);
  assertEquals(result.coerced, false);
  assertEquals(payload.footprint_source, "regrid_parcel");
  assert(!("footprint_source_diagnostic" in geometry));
});

Deno.test("chokepoint coercion: null payload + null geometry is a no-op", () => {
  const payload: Record<string, unknown> = {};
  const geometry: Record<string, unknown> = {};
  const result = applyFootprintSourceDbSafeCoercion(payload, geometry);
  assertEquals(result.coerced, false);
  assertEquals(result.raw, null);
  assertEquals(payload.footprint_source, undefined);
});

Deno.test("chokepoint coercion: reads from geometry when top-level missing", () => {
  const payload: Record<string, unknown> = {};
  const geometry: Record<string, unknown> = {
    footprint_source: "blocked_by_registration_gate",
  };
  applyFootprintSourceDbSafeCoercion(payload, geometry);
  assertEquals(payload.footprint_source, "unknown");
  assertEquals(geometry.footprint_source, "unknown");
  assertEquals(
    geometry.footprint_source_diagnostic,
    "blocked_by_registration_gate",
  );
});
