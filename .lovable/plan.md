## Goal

Force the derived DSM registration to execute and persist **before** Phase 3A/3A.5/topology can burn the CPU budget, so the live Fonsica row carries the full v1 derived-bounds diagnostic surface even when CPU preempts later.

No DSM math changes. No new transform algorithms. Reuse the already-tested `buildDsmRegistration` + `applyLiveRuntimeHoistToRegistration` helpers (the `derived_from_raster_bounds` path is already green in 6 tests).

## Why this is the right fix

- `start-ai-measurement/index.ts` has **two** existing `buildDsmRegistration` call sites:
  - **Site #2** at L6531 — early classification path, hard-coded `allow_derived_bounds: false` (comment explicitly says "raster-bounds derivation stays disabled" here).
  - **Site #1** at L1480 (inside `applyLiveRuntimeHoistToRegistration`, called during payload prep ~L1887/1963/1975) — honors `allow_derived_bounds`, but only runs when we assemble the final geometry payload, well after Phase 3A.
- Fonsica's last run (`8d0828fc…`) completed Phase 3A perimeter classification (225.89 LF eaves) but preempted with `ai_measurement_cpu_timeout` before any payload-prep hoist, so every derived-bounds field on `roof_measurements 23a8c99f…` is null/false.
- The pre-Phase-3A.5 preempt block (L6951–7012) already calls `resolveRegistrationForPreempt` and persists via `persistCpuBudgetTerminalFailure`, but that resolver does **not** run the derived-bounds attempt — it just reuses whatever `hoistedTransformPackage` was built at Site #2 (which had derivation disabled).

## Implementation

### 1. New early callsite: `early_dsm_registration_before_topology`

Insert immediately after Site #2 in `start-ai-measurement/index.ts` (after the existing Site #2 block ends, before Phase 3A perimeter classification begins). It runs only when all gating inputs are present:

- `dsm_loaded === true`
- `_dsmSizePx` (dsm_size_px) populated
- `raster_bounds_lat_lng` populated on `_transformPkg`
- `raster.width/height` populated
- `geo_to_raster_transform` populated on `_transformPkg`
- `frame_mismatch === "ok"` (from `dsmCoordinateMatchDebug` / target-mask isolation)
- selected perimeter / target-mask present
- `target_mask_overlap_with_perimeter >= 0.90`

If any gating input is missing → skip silently, leave Site #1 (later hoist) as the authority. No new failure tokens.

If gating passes:

1. Re-invoke `buildDsmRegistration({ ...same inputs as Site #2, allow_derived_bounds: true })`.
2. Re-invoke `buildRegistrationTransformPackage(...)` with the derived `dsm_tile_bounds_lat_lng` / `dsm_size_px` / `dsm_meters_per_pixel`.
3. Overwrite the hoisted vars (`hoistedTransformPackage`, `hoistedRasterBoundsLatLng`, `hoistedGeoToRasterTransform`, `hoistedConfirmedRoofCenterPx`) **only if** the derived result reports `dsm_bounds_source === "derived_from_raster_bounds"` and validation passes.
4. Stash the success on `geometry` (and a top-level scratch field that the payload-prep stage already reads) so payload-prep doesn't blow it away:
  - `dsm_bounds_derived = true`
  - `dsm_tile_bounds_source = "derived_from_raster_bounds"`
  - `geo_to_dsm_transform`
  - `dsm_to_raster_transform`
  - `confirmed_roof_center_dsm_px`
  - `geo_to_dsm_px_success = true`
  - `dsm_pixel_transform_valid = true`
  - `derived_bounds_enabled = true`
  - `derived_bounds_policy = "dsm-registration-derived-bounds-v1"`
  - `derived_bounds_validation_passed = true`
  - `derived_bounds_validation_failures = []`
  - `dsm_raster_roundtrip_error_px` (< 8 required)
  - `dsm_validation_status.reason = "derived_bounds_validated"`
  - `dsm_registration_callsite = "early_dsm_registration_before_topology"`

### 2. Preserve early registration across CPU preempt

- Extend `resolveRegistrationForPreempt` (or wrap its result) so that when the early callsite already populated `hoistedTransformPackage` with derived bounds, the resolver **returns those values unchanged** instead of rebuilding from raw input. Today the rebuild path can drop derived fields.
- Update `persistCpuBudgetTerminalFailure` / the terminal `failurePayload` writer (L15546+, L15758 `failurePayload`, L14076 `pre_phase3_5_preempt` debug payload) so it merges-in the early derived-bounds fields when present, instead of letting the failure path null them out.
- Specifically: in payload-prep (L1854–1981), when `result.failure` quarantines stale geometry, the derived registration block must be preserved (the existing `applyLiveRuntimeHoistToRegistration` call on L1887 already does this if the geometry carries the derived fields — confirm by adding the new fields to its preserve-list).

### 3. CPU preempt ordering adjustment

In the pre-Phase-3A.5 preempt branch (L6956) and the Phase-3A.5 preempt branch (L7017): before calling `persistCpuBudgetTerminalFailure`, check whether the early derived-bounds attempt has run. If not and all inputs are present, run it inline once (same helper as step 1), persist the result onto the resolved registration, then write the terminal failure. This is the "run derived registration first, then terminal-fail" requirement.

### 4. Regression tests (Deno, run via `supabase--test_edge_functions`)

`**supabase/functions/start-ai-measurement/__tests__/early-dsm-registration-before-cpu-preempt.test.ts**` (positive)

Fonsica-shaped fixture:

- DSM loaded; `dsm_size_px = { width: 998, height: 998 }`
- `raster_size_px = { width: 1280, height: 1280 }`
- `raster_bounds_lat_lng` and `geo_to_raster_transform` present
- `frame_mismatch = "ok"`
- `target_mask_overlap_with_perimeter = 0.976`
- selected perimeter present
- CPU budget primed to preempt at the pre-Phase-3A.5 checkpoint

Assertions:

- The `early_dsm_registration_before_topology` callsite runs **before** the terminal preempt write (ordering assertion via a probe).
- On the persisted `failurePayload` / terminal debug payload:
  - `dsm_bounds_derived === true`
  - `dsm_tile_bounds_source === "derived_from_raster_bounds"`
  - `geo_to_dsm_transform` non-null
  - `dsm_to_raster_transform` non-null
  - `confirmed_roof_center_dsm_px` non-null
  - `geo_to_dsm_px_success === true`
  - `dsm_pixel_transform_valid === true`
  - `dsm_validation_status.reason === "derived_bounds_validated"`
  - `dsm_registration_callsite === "early_dsm_registration_before_topology"`
  - `customer_report_ready === false`
  - `reportable_roof_lines_count === 0`
  - `result_state` normalized via `normalizeResultStateForWrite` (still a failure bucket, e.g. `ai_failed_runtime`), `hard_fail_reason === "ai_measurement_cpu_timeout"`

**Negative test in the same file** (or sibling): when `frame_mismatch !== "ok"` OR `target_mask_overlap_with_perimeter < 0.90`:

- early callsite does not run
- terminal payload keeps the original `dsm_tile_bounds_missing_from_google_solar_metadata` token
- `geo_to_dsm_px_success === false`
- `dsm_pixel_transform_valid === false`
- no `dsm_registration_callsite` field set (or set to a `skipped_*` value)

### 5. Deploy + Fonsica rerun

After tests are green:

1. Deploy `start-ai-measurement`.
2. POST `/start-ai-measurement` for lead `0a38230e-…` with `allow_derived_bounds: true`, `user_confirmed_roof_target: true`, `roof_target_admin_override: true`.
3. Poll `ai_measurement_jobs` + latest `roof_measurements` row.
4. Verify the acceptance fields from the prompt are populated on the new row even if CPU still preempts.

## Files touched

- `supabase/functions/start-ai-measurement/index.ts` — add early callsite, extend preempt branches, preserve derived fields in failure payload.
- `supabase/functions/start-ai-measurement/__tests__/early-dsm-registration-before-cpu-preempt.test.ts` — new positive + negative regression tests.
- (Possibly) `supabase/functions/_shared/dsm-diagnostic-propagation.ts` — extend preserve-list for new top-level fields if it actively filters them. Read-and-confirm before editing.

## Out of scope (do not touch)

- `_shared/dsm-derived-bounds-runtime.ts`, `_shared/dsm-registration.ts` math
- `customer_report_ready` gates, reportable roof-line promotion
- Overlay transform resolver, topology / pitch / facet promotion
- UI, DB schema

## Acceptance on Fonsica rerun

On the next `roof_measurements` row for lead `0a38230e-…`:

- `geometry_report_json.dsm_bounds_derived = true`
- `dsm_tile_bounds_source = "derived_from_raster_bounds"`
- `geo_to_dsm_transform`, `dsm_to_raster_transform`, `confirmed_roof_center_dsm_px` populated
- `geo_to_dsm_px_success = true`, `dsm_pixel_transform_valid = true`
- `dsm_validation_status.reason = "derived_bounds_validated"`
- `dsm_registration_callsite = "early_dsm_registration_before_topology"`
- CPU preempt may still occur; `customer_report_ready` stays `false`; reportable roof lines stay `0`.  
  
The Lovable plan is solid. Approve it.
  This is the right fix because it does **not** change the DSM math. It moves the already-tested derived DSM registration earlier so the live Fonsica run can persist the transform before CPU preemption wipes out the opportunity. The plan correctly identifies that Site #2 currently has `allow_derived_bounds: false`, while the later Site #1 honors derived bounds but happens too late in the pipeline.
  Send this:
  ```

  ```
  ```
  Go.

  Implement Early DSM Registration Before Topology exactly as scoped.

  This is a wiring/order fix only.

  Do not touch:
  - _shared/dsm-derived-bounds-runtime.ts math
  - _shared/dsm-registration.ts transform algorithms
  - customer_report_ready gates
  - reportable roof line promotion
  - overlay transform resolver
  - topology/pitch/facet promotion
  - UI
  - DB schema

  Current facts:
  - All 6 derived-bounds tests pass.
  - Derived DSM fallback works in tests.
  - start-ai-measurement is deployed.
  - Live Fonsica still preempted before derived registration ran.
  - Site #2 at L6531 runs earlier but has allow_derived_bounds: false.
  - Site #1 at L1480 honors allow_derived_bounds but runs too late during final payload prep.
  - Pre-Phase-3A.5 preempt currently persists from hoistedTransformPackage built with derivation disabled.

  Goal:
  Run and persist derived DSM registration before Phase 3A/3A.5/topology can burn CPU budget.

  Required implementation:

  1. Add early callsite:
  dsm_registration_callsite = "early_dsm_registration_before_topology"

  Place immediately after the existing Site #2 registration block and before Phase 3A perimeter classification begins.

  2. Only run early derived registration when all inputs are present:

  - dsm_loaded === true
  - dsm_size_px populated
  - raster_bounds_lat_lng populated
  - raster width/height populated
  - geo_to_raster_transform populated
  - frame_mismatch === "ok"
  - selected perimeter or target mask present
  - target_mask_overlap_with_perimeter >= 0.90

  If any input is missing:
  - skip silently
  - do not emit new failure tokens
  - leave later Site #1 as authority

  3. If gate passes:

  Re-invoke buildDsmRegistration with the same inputs as Site #2 but:

  allow_derived_bounds: true

  Then re-invoke buildRegistrationTransformPackage with:
  - derived dsm_tile_bounds_lat_lng
  - dsm_size_px
  - dsm_meters_per_pixel
  - geo_to_raster_transform
  - confirmed roof center

  4. Only overwrite hoisted vars if derived result is valid:

  Required condition:
  - dsm_bounds_source === "derived_from_raster_bounds"
  - dsm_pixel_transform_valid === true
  - geo_to_dsm_px_success === true
  - dsm_tile_bounds_contain_confirmed_center === true
  - dsm_raster_roundtrip_error_px < 8

  Then update:
  - hoistedTransformPackage
  - hoistedRasterBoundsLatLng
  - hoistedGeoToRasterTransform
  - hoistedConfirmedRoofCenterPx

  5. Persist/stash derived registration on geometry immediately.

  Required fields:
  - dsm_bounds_derived = true
  - dsm_tile_bounds_source = "derived_from_raster_bounds"
  - geo_to_dsm_transform populated
  - dsm_to_raster_transform populated
  - confirmed_roof_center_dsm_px populated
  - geo_to_dsm_px_success = true
  - dsm_pixel_transform_valid = true
  - derived_bounds_enabled = true
  - derived_bounds_policy = "dsm-registration-derived-bounds-v1"
  - derived_bounds_validation_passed = true
  - derived_bounds_validation_failures = []
  - dsm_raster_roundtrip_error_px numeric and < 8
  - dsm_validation_status.reason = "derived_bounds_validated"
  - dsm_registration_callsite = "early_dsm_registration_before_topology"

  6. Preserve early registration across CPU preempt.

  Extend resolveRegistrationForPreempt or wrap its result so that if early derived registration populated hoistedTransformPackage, the preempt resolver returns those derived values unchanged.

  Do not rebuild from raw input and drop:
  - geo_to_dsm_transform
  - dsm_to_raster_transform
  - confirmed_roof_center_dsm_px
  - dsm_pixel_transform_valid
  - geo_to_dsm_px_success
  - dsm_validation_status.reason = derived_bounds_validated

  7. Before CPU terminal failure writes, ensure early derived registration has run if possible.

  In:
  - pre-Phase-3A.5 preempt branch
  - Phase-3A.5 preempt branch

  Before calling persistCpuBudgetTerminalFailure:
  - if early derived registration has not run
  - and all inputs are present
  - run early derived registration once
  - merge it into resolved registration / terminal payload
  - then write terminal failure

  8. Regression tests.

  Add:
  supabase/functions/start-ai-measurement/__tests__/early-dsm-registration-before-cpu-preempt.test.ts

  Positive Fonsica-shaped test:
  - DSM loaded
  - dsm_size_px = 998×998
  - raster_size_px = 1280×1280
  - raster_bounds_lat_lng present
  - geo_to_raster_transform present
  - frame_mismatch = "ok"
  - target_mask_overlap_with_perimeter = 0.976
  - selected perimeter present
  - CPU budget primed to preempt at pre-Phase-3A.5 checkpoint

  Assert:
  - early_dsm_registration_before_topology runs before terminal preempt write
  - terminal failure payload preserves:
    - dsm_bounds_derived = true
    - dsm_tile_bounds_source = "derived_from_raster_bounds"
    - geo_to_dsm_transform non-null
    - dsm_to_raster_transform non-null
    - confirmed_roof_center_dsm_px non-null
    - geo_to_dsm_px_success = true
    - dsm_pixel_transform_valid = true
    - dsm_validation_status.reason = "derived_bounds_validated"
    - dsm_registration_callsite = "early_dsm_registration_before_topology"
  - customer_report_ready remains false
  - reportable_roof_lines_count remains 0
  - result_state remains failure bucket, e.g. ai_failed_runtime
  - hard_fail_reason remains ai_measurement_cpu_timeout

  Negative test:
  When frame_mismatch !== "ok" OR target_mask_overlap_with_perimeter < 0.90:
  - early callsite does not run
  - terminal payload keeps original dsm_tile_bounds_missing_from_google_solar_metadata token
  - geo_to_dsm_px_success = false
  - dsm_pixel_transform_valid = false
  - no dsm_registration_callsite is set, or it is set to an explicit skipped reason

  9. Tests + deploy.

  Run targeted tests:
  - early-dsm-registration-before-cpu-preempt.test.ts
  - derived-dsm-bounds-fonsica-end-to-end.test.ts
  - dsm-derived-bounds-fonsica.test.ts

  If green:
  - deploy start-ai-measurement
  - rerun Fonsica
  - verify runtime row

  Acceptance on next Fonsica:
  - dsm_bounds_derived = true
  - dsm_tile_bounds_source = "derived_from_raster_bounds"
  - geo_to_dsm_transform populated
  - dsm_to_raster_transform populated
  - confirmed_roof_center_dsm_px populated
  - geo_to_dsm_px_success = true
  - dsm_pixel_transform_valid = true
  - dsm_validation_status.reason = "derived_bounds_validated"
  - dsm_registration_callsite = "early_dsm_registration_before_topology"
  - CPU may still preempt later
  - customer_report_ready remains false
  - reportable roof lines remain 0
  ```
  This is the correct unlock. Once this passes on Fonsica, the next real prompt becomes topology/pitch/facet validation rather than DSM registration.