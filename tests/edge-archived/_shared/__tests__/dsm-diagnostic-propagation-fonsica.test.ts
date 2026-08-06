// dsm-diagnostic-propagation-fonsica.test.ts
//
// Regression: latest Fonsica proves runtime has
//   dsm_split_status.dsm_loaded = true
//   dsm_split_status.dsm_size_px = { width: 998, height: 998 }
// but the persisted row still shows registration.dsm_size_px = null and
// registration.transform_package.dsm_size_px = null, with no
// dsm_tile_bounds_failure_reason / dsm_registration_failure_token /
// dsm_transform_policy_version on any active registration surface.
//
// This test pins the final merge/write boundary: after
// ensureDsmDiagnosticsOnRegistration runs, every active registration
// surface MUST carry the flat DSM diagnostic fields seeded from
// dsm_split_status, idempotently.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const { ensureDsmDiagnosticsOnRegistration } = await import(
  "../dsm-diagnostic-propagation.ts"
);

function buildFonsicaPayload() {
  return {
    geometry_report_json: {
      registration: {
        dsm_size_px: null,
        dsm_tile_bounds_lat_lng: null,
        transform_package: { dsm_size_px: null },
      },
      registration_gate: { transform_package: {} },
      dsm_planar_graph_debug: { registration: { transform_package: {} } },
      dsm_split_status: {
        dsm_loaded: true,
        dsm_size_px: { width: 998, height: 998 },
        georegistration_transform: {},
      },
      dsm_validation_status: { reason: "invalid_transform" },
    },
  } as Record<string, unknown>;
}

const EXPECTED_SIZE = { width: 998, height: 998 };
const EXPECTED_TOKEN =
  "dsm_tile_bounds_missing_from_google_solar_metadata";
const EXPECTED_POLICY = "dsm-registration-transform-v1";
const EXPECTED_SIZE_SOURCE = "dsm_split_status.dsm_size_px";

function assertFlatDsmFieldsPopulated(
  label: string,
  target: Record<string, unknown> | undefined | null,
) {
  assert(target && typeof target === "object", `${label}: target missing`);
  assertEquals(
    (target as any).dsm_size_px,
    EXPECTED_SIZE,
    `${label}: dsm_size_px`,
  );
  assertEquals(
    (target as any).dsm_size_source,
    EXPECTED_SIZE_SOURCE,
    `${label}: dsm_size_source`,
  );
  assertEquals(
    (target as any).dsm_tile_bounds_failure_reason,
    EXPECTED_TOKEN,
    `${label}: dsm_tile_bounds_failure_reason`,
  );
  assertEquals(
    (target as any).dsm_registration_failure_token,
    EXPECTED_TOKEN,
    `${label}: dsm_registration_failure_token`,
  );
  assertEquals(
    (target as any).dsm_transform_policy_version,
    EXPECTED_POLICY,
    `${label}: dsm_transform_policy_version`,
  );
}

Deno.test("Fonsica: flat DSM diagnostics propagate to every active registration surface", () => {
  const result = ensureDsmDiagnosticsOnRegistration(buildFonsicaPayload());
  const geom = (result as any).geometry_report_json as Record<string, unknown>;

  assertFlatDsmFieldsPopulated("registration", geom.registration as any);
  assertFlatDsmFieldsPopulated(
    "registration.transform_package",
    (geom.registration as any).transform_package,
  );
  assertFlatDsmFieldsPopulated(
    "registration_gate",
    geom.registration_gate as any,
  );
  assertFlatDsmFieldsPopulated(
    "registration_gate.transform_package",
    (geom.registration_gate as any).transform_package,
  );
  assertFlatDsmFieldsPopulated(
    "dsm_planar_graph_debug.registration",
    (geom.dsm_planar_graph_debug as any).registration,
  );
  assertFlatDsmFieldsPopulated(
    "dsm_planar_graph_debug.registration.transform_package",
    ((geom.dsm_planar_graph_debug as any).registration as any).transform_package,
  );
  assertFlatDsmFieldsPopulated(
    "dsm_split_status.georegistration_transform",
    (geom.dsm_split_status as any).georegistration_transform,
  );

  // dsm_validation_status: generic reason preserved, sibling added.
  const dvs = (geom as any).dsm_validation_status as Record<string, unknown>;
  assertEquals(dvs.reason, "invalid_transform");
  assertEquals(
    dvs.dsm_validation_status_specific_reason,
    EXPECTED_TOKEN,
  );
});

Deno.test("Fonsica: helper is idempotent — second pass equals first pass", () => {
  const a = ensureDsmDiagnosticsOnRegistration(buildFonsicaPayload());
  const b = ensureDsmDiagnosticsOnRegistration(a);
  // Strip timestamp before comparing (set fresh per call).
  const stripTs = (p: any) => {
    const g = p.geometry_report_json;
    if (g?.registration) {
      delete g.registration.dsm_diagnostic_propagation_at;
    }
    if (g?.registration_gate) {
      delete g.registration_gate.dsm_diagnostic_propagation_at;
    }
    return p;
  };
  assertEquals(
    JSON.stringify(stripTs(structuredClone(b))),
    JSON.stringify(stripTs(structuredClone(a))),
  );
});

Deno.test("Fonsica: when bounds ARE present, no missing-bounds failure tokens are added", () => {
  const payload = buildFonsicaPayload();
  const geom = (payload as any).geometry_report_json;
  geom.registration.dsm_tile_bounds_lat_lng = {
    north: 1,
    south: 0,
    east: 1,
    west: 0,
  };
  geom.registration.transform_package.dsm_tile_bounds_lat_lng =
    geom.registration.dsm_tile_bounds_lat_lng;

  const result = ensureDsmDiagnosticsOnRegistration(payload);
  const reg = (result as any).geometry_report_json.registration as Record<
    string,
    unknown
  >;
  assertEquals(reg.dsm_tile_bounds_failure_reason ?? null, null);
  assertEquals(reg.dsm_registration_failure_token ?? null, null);
  assertEquals(reg.dsm_transform_policy_version ?? null, null);

  const dvs = (result as any).geometry_report_json.dsm_validation_status as
    | Record<string, unknown>
    | undefined;
  assertEquals(dvs?.dsm_validation_status_specific_reason ?? null, null);
});
