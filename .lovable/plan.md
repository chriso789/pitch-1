# DSM Diagnostic Write/Merge Propagation Fix

Scope: backend only. No UI grouping, banner copy, aerial graph, CPU containment, overlay transform, customer-report gate, topology solver, roof-line promotion, or DB schema changes.

## Problem

`dsm_split_status.dsm_size_px = { width: 998, height: 998 }` and `dsm_loaded = true` are present at runtime, but the persisted `geometry_report_json` still has:

- `registration.dsm_size_px = null`
- `registration.transform_package.dsm_size_px = null`
- `dsm_tile_bounds_lat_lng = null`
- `dsm_validation_status.reason = invalid_transform` (generic)
- missing `dsm_tile_bounds_failure_reason`, `dsm_registration_failure_token`, `dsm_transform_policy_version`, `geo_to_dsm_transform_source`, `dsm_to_raster_transform_source`, `confirmed_roof_center_dsm_px_source`, `dsm_size_source`.

The existing propagation helper only writes a nested `registration.dsm` projection — it does not seed the flat fields on `registration`/`transform_package`/`dsm_planar_graph_debug` that the persisted row exposes.

## Files to change

1. `supabase/functions/_shared/dsm-diagnostic-propagation.ts` — extend `ensureDsmDiagnosticsOnRegistration` to also write flat DSM fields, and mirror into the four additional targets.
2. `supabase/functions/start-ai-measurement/index.ts` — ensure `ensureDsmDiagnosticsOnRegistration` is called at the final merge boundary (immediately before `insertRoofMeasurementWithSchemaGuard`), after all DSM writes, on both success and failure paths.
3. `supabase/functions/_shared/__tests__/dsm-diagnostic-propagation.test.ts` — new Fonsica-shaped regression test (extend existing `dsm-diagnostic-nested-projection.test.ts` style).

## Helper changes

Inside `ensureDsmDiagnosticsOnRegistration`, after step (5):

A. Resolve effective DSM diagnostics (single source of truth, idempotent):

```text
effectiveDsmSize  = regNext.dsm_size_px
                  ?? transform_package.dsm_size_px
                  ?? dsm_split_status.dsm_size_px
                  ?? null
dsmLoaded         = dsm_split_status.dsm_loaded === true
boundsMissing     = regNext.dsm_tile_bounds_lat_lng == null
                    && transform_package.dsm_tile_bounds_lat_lng == null
```

B. Derive missing diagnostic tokens (only when not already set):

```text
if (effectiveDsmSize && !regNext.dsm_size_source)
  regNext.dsm_size_source = "dsm_split_status.dsm_size_px"

if (dsmLoaded && boundsMissing) {
  regNext.dsm_tile_bounds_failure_reason ??= "dsm_tile_bounds_missing_from_google_solar_metadata"
  regNext.dsm_registration_failure_token  ??= "dsm_tile_bounds_missing_from_google_solar_metadata"
  regNext.dsm_transform_policy_version    ??= "dsm-registration-transform-v1"
}
```

C. Mirror flat diagnostic surface into all four targets via a small `mergeFlatDsmFields(target)` helper that copies (without overwriting non-null values):

- `dsm_size_px`, `dsm_size_source`
- `dsm_tile_bounds_lat_lng` (preserve null), `dsm_tile_bounds_failure_reason`
- `dsm_registration_failure_token`, `dsm_transform_policy_version`
- `geo_to_dsm_transform_source`, `dsm_to_raster_transform_source`, `confirmed_roof_center_dsm_px_source`

Targets:

- `geometry.registration` and `geometry.registration.transform_package`
- `geometry.registration_gate` and `geometry.registration_gate.transform_package`
- `geometry.dsm_planar_graph_debug.registration` and its `.transform_package`
- `geometry.dsm_split_status.georegistration_transform`

If `transform_package` / `dsm_planar_graph_debug` / `dsm_split_status.georegistration_transform` are missing, create them as empty objects before merging — propagation must never throw on absent sub-objects.

D. `dsm_validation_status`: keep generic `reason` as fallback. Add a sibling field only:

```text
if (regNext.dsm_validation_status?.reason && boundsMissing)
  regNext.dsm_validation_status.dsm_validation_status_specific_reason
    = "dsm_tile_bounds_missing_from_google_solar_metadata"
```

Do not overwrite `reason`.

E. Idempotency: every assignment uses `??=` / null-coalesce so re-running the helper is a no-op when real values exist.

## start-ai-measurement integration

Confirm a single call site, immediately before `insertRoofMeasurementWithSchemaGuard(...)` for both the success-write block and the failure-write block (around lines ~6700 and ~15800 in the current file). The merged result replaces the in-memory payload so the schema-guard insert sees the propagated fields.

No other code paths change. The existing `applyLiveRuntimeHoistToRegistration` hoist is preserved as the `options.hoist` argument.

## Regression test

`supabase/functions/_shared/__tests__/dsm-diagnostic-propagation-fonsica.test.ts`:

Input fixture:

```text
geometry_report_json: {
  registration: { dsm_size_px: null, dsm_tile_bounds_lat_lng: null,
                  transform_package: { dsm_size_px: null } },
  registration_gate: { transform_package: {} },
  dsm_planar_graph_debug: { registration: { transform_package: {} } },
  dsm_split_status: {
    dsm_loaded: true,
    dsm_size_px: { width: 998, height: 998 },
    georegistration_transform: {},
  },
  dsm_validation_status: { reason: "invalid_transform" },
}
```

Assertions after `ensureDsmDiagnosticsOnRegistration(payload)`:

- For each of the six targets listed in step C plus `dsm_split_status.georegistration_transform`:
  - `.dsm_size_px === { width: 998, height: 998 }`
  - `.dsm_size_source === "dsm_split_status.dsm_size_px"`
  - `.dsm_tile_bounds_failure_reason === "dsm_tile_bounds_missing_from_google_solar_metadata"`
  - `.dsm_registration_failure_token === "dsm_tile_bounds_missing_from_google_solar_metadata"`
  - `.dsm_transform_policy_version === "dsm-registration-transform-v1"`
- `dsm_validation_status.reason === "invalid_transform"` (unchanged)
- `dsm_validation_status.dsm_validation_status_specific_reason === "dsm_tile_bounds_missing_from_google_solar_metadata"`
- Re-running the helper twice produces identical output (idempotency).
- A second case where `dsm_tile_bounds_lat_lng` IS present must NOT add the failure tokens.

Run command: `supabase--test_edge_functions` with `functions: ["_shared"]` (or the specific file via `pattern`).

## Acceptance on next Fonsica run

- Persisted `registration.dsm_size_px = { width: 998, height: 998 }`
- `dsm_tile_bounds_failure_reason = dsm_tile_bounds_missing_from_google_solar_metadata`
- `dsm_transform_policy_version = dsm-registration-transform-v1`
- All existing green items unchanged: aerial graph 12 edges, CPU < 75000ms, `frame_mismatch` ok, `customer_report_ready=false`, reportable roof lines `0`.  
  
I checked the repo enough to say: **yes, the repo is ready for this plan**, but the plan needs one small correction before you send it.
  The key files already exist:
  - `supabase/functions/_shared/dsm-diagnostic-propagation.ts` exists and already contains `ensureDsmDiagnosticsOnRegistration`.
  - There are already DSM propagation tests:
    - `dsm-diagnostic-nested-projection.test.ts`
    - `dsm-diagnostic-propagation-writer.test.ts`
  - There is also a debug-runtime DSM propagation test already present.
  So this is not a “create from scratch” situation. It is an **extend the existing helper + guarantee final merge boundary call** situation.
  ## The one correction
  Your plan says:
  ```

  ```
  ```
  all four targets
  ```
  But then lists more than four surfaces:
  ```

  ```
  ```
  registration
  registration.transform_package
  registration_gate
  registration_gate.transform_package
  dsm_planar_graph_debug.registration
  dsm_planar_graph_debug.registration.transform_package
  dsm_split_status.georegistration_transform
  ```
  So call it **all active registration surfaces**, not “four targets.”
  ## Send this refined prompt
  ```

  ```
  ```
  Implement DSM Diagnostic Write/Merge Propagation Fix.

  Scope:
  Backend only.

  Do not touch:
  - UI grouping
  - registration banner copy
  - aerial graph builder/resolver
  - CPU containment
  - overlay transforms
  - customer-report gates
  - topology solver
  - roof-line promotion
  - DB schema/migrations

  Repo readiness:
  The repo already has:
  - supabase/functions/_shared/dsm-diagnostic-propagation.ts
  - ensureDsmDiagnosticsOnRegistration
  - existing DSM diagnostic propagation tests

  Do not create a duplicate helper. Extend the existing helper.

  Problem:
  Latest Fonsica proves runtime has:

  dsm_split_status.dsm_loaded = true
  dsm_split_status.dsm_size_px = { width: 998, height: 998 }

  But persisted geometry_report_json still shows:

  registration.dsm_size_px = null
  registration.transform_package.dsm_size_px = null
  dsm_tile_bounds_lat_lng = null
  dsm_validation_status.reason = invalid_transform

  And missing:

  dsm_size_source
  dsm_tile_bounds_failure_reason
  dsm_registration_failure_token
  dsm_transform_policy_version
  geo_to_dsm_transform_source
  dsm_to_raster_transform_source
  confirmed_roof_center_dsm_px_source

  Required changes:

  1. Extend existing:
  supabase/functions/_shared/dsm-diagnostic-propagation.ts

  Inside ensureDsmDiagnosticsOnRegistration, after existing nested registration.dsm projection, resolve effective DSM diagnostics:

  const effectiveDsmSize =
    regNext.dsm_size_px
    ?? regNext.transform_package?.dsm_size_px
    ?? geometry.dsm_split_status?.dsm_size_px
    ?? null;

  const dsmLoaded =
    geometry.dsm_split_status?.dsm_loaded === true;

  const boundsMissing =
    regNext.dsm_tile_bounds_lat_lng == null
    && regNext.transform_package?.dsm_tile_bounds_lat_lng == null;

  If effectiveDsmSize exists and dsm_size_source is missing, set:
  dsm_size_source = "dsm_split_status.dsm_size_px"

  If dsmLoaded && boundsMissing, set if missing:
  dsm_tile_bounds_failure_reason = "dsm_tile_bounds_missing_from_google_solar_metadata"
  dsm_registration_failure_token = "dsm_tile_bounds_missing_from_google_solar_metadata"
  dsm_transform_policy_version = "dsm-registration-transform-v1"

  2. Add a mergeFlatDsmFields(target) helper.

  It must copy without overwriting non-null existing values:

  - dsm_size_px
  - dsm_size_source
  - dsm_tile_bounds_lat_lng
  - dsm_tile_bounds_failure_reason
  - dsm_registration_failure_token
  - dsm_transform_policy_version
  - geo_to_dsm_transform_source
  - dsm_to_raster_transform_source
  - confirmed_roof_center_dsm_px_source

  Important:
  - Preserve null for dsm_tile_bounds_lat_lng if missing.
  - Do not overwrite real future values.
  - Use nullish coalescing / ??= where possible.
  - Helper must be idempotent.

  Mirror the flat DSM diagnostics into all active registration surfaces:

  - geometry_report_json.registration
  - geometry_report_json.registration.transform_package
  - geometry_report_json.registration_gate
  - geometry_report_json.registration_gate.transform_package
  - geometry_report_json.dsm_planar_graph_debug.registration
  - geometry_report_json.dsm_planar_graph_debug.registration.transform_package
  - geometry_report_json.dsm_split_status.georegistration_transform

  If transform_package, dsm_planar_graph_debug, registration, or georegistration_transform are missing, create safe empty objects before merging.
  Propagation must never throw on absent sub-objects.

  3. dsm_validation_status behavior

  Do not overwrite:
  dsm_validation_status.reason = "invalid_transform"

  Instead add sibling:
  dsm_validation_status_specific_reason = "dsm_tile_bounds_missing_from_google_solar_metadata"

  when bounds are missing.

  4. start-ai-measurement integration

  Confirm ensureDsmDiagnosticsOnRegistration is called at the final geometry_report_json merge boundary immediately before insert/write of the measurement row.

  It must run on both:
  - success write path
  - failure/runtime-preempt write path

  The returned/merged object must replace the in-memory payload so the schema guard insert sees the propagated fields.

  Do not rely only on early hoists. The latest live row proves early registration still lands with null DSM size.

  5. Tests

  Extend existing DSM diagnostic propagation tests or add:

  supabase/functions/_shared/__tests__/dsm-diagnostic-propagation-fonsica.test.ts

  Input:
  geometry_report_json = {
    registration: {
      dsm_size_px: null,
      dsm_tile_bounds_lat_lng: null,
      transform_package: { dsm_size_px: null }
    },
    registration_gate: { transform_package: {} },
    dsm_planar_graph_debug: {
      registration: { transform_package: {} }
    },
    dsm_split_status: {
      dsm_loaded: true,
      dsm_size_px: { width: 998, height: 998 },
      georegistration_transform: {}
    },
    dsm_validation_status: { reason: "invalid_transform" }
  }

  Expected:
  For all active registration surfaces:
  - registration
  - registration.transform_package
  - registration_gate
  - registration_gate.transform_package
  - dsm_planar_graph_debug.registration
  - dsm_planar_graph_debug.registration.transform_package
  - dsm_split_status.georegistration_transform

  Assert:
  - dsm_size_px = { width: 998, height: 998 }
  - dsm_size_source = "dsm_split_status.dsm_size_px"
  - dsm_tile_bounds_failure_reason = "dsm_tile_bounds_missing_from_google_solar_metadata"
  - dsm_registration_failure_token = "dsm_tile_bounds_missing_from_google_solar_metadata"
  - dsm_transform_policy_version = "dsm-registration-transform-v1"

  Also assert:
  - dsm_validation_status.reason remains "invalid_transform"
  - dsm_validation_status_specific_reason = "dsm_tile_bounds_missing_from_google_solar_metadata"
  - running ensureDsmDiagnosticsOnRegistration twice produces the same output
  - if dsm_tile_bounds_lat_lng is present, no missing-bounds failure tokens are added

  6. Run tests

  Run:
  supabase--test_edge_functions for _shared DSM diagnostic tests.

  7. Deploy and rerun Fonsica

  Acceptance:
  - registration.dsm_size_px = { width: 998, height: 998 }
  - registration.transform_package.dsm_size_px = { width: 998, height: 998 }
  - registration_gate.transform_package.dsm_size_px = { width: 998, height: 998 }
  - DSM Size row shows 998×998
  - DSM Bounds Failure shows dsm_tile_bounds_missing_from_google_solar_metadata
  - DSM Transform Policy shows dsm-registration-transform-v1
  - dsm_validation_status_specific_reason shows dsm_tile_bounds_missing_from_google_solar_metadata
  - Existing green items unchanged:
    aerial graph executed with 12 edges
    CPU elapsed under 75000ms
    frame_mismatch ok
    customer_report_ready false
    Reportable Roof Lines 0
  ```
  Bottom line: **ready to implement**. The helper already exists; this is a targeted extension and final-write integration check, not a new subsystem.