# Controlled Derived DSM Bounds Fallback v1 — Finish the Wiring

## Current State (verified in code)

Most of the spec is already implemented in `supabase/functions/_shared/dsm-registration.ts` and `supabase/functions/start-ai-measurement/index.ts`:

- `DsmBoundsSource = "derived_from_raster_bounds"` exists.
- `DSM_DERIVED_TRANSFORM_POLICY_VERSION = "dsm-registration-derived-bounds-v1"` exported.
- `buildDsmRegistration` honors `allow_derived_bounds` + `rasterBoundsLatLng` + `rasterSizePx` and sets `dsm_bounds_derived`, `dsm_bounds_warning`, `dsm_bounds_confidence`, `dsm_meters_per_pixel`, and emits `dsm_tile_bounds_derived_from_raster_bounds`.
- `applyLiveRuntimeHoistToRegistration` computes `_allowDerivedBounds` from `dsm_loaded` + `raster_bounds_lat_lng` + `raster_mpp` + `frame_mismatch === "ok"` + `target_mask_overlap_with_perimeter >= 0.90`.
- `buildRegistrationTransformPackage` is invoked to produce `geo_to_dsm_transform`, `dsm_to_raster_transform`, `confirmed_roof_center_dsm_px`, `geo_to_dsm_px_success`, `dsm_pixel_transform_valid`, `dsm_tile_bounds_contain_confirmed_center`.
- Consistency rejection already exists (clears transforms + restores failure token if confirmed center falls outside derived bounds or `dsm_pixel_transform_valid !== true`).
- Unit test `supabase/functions/_shared/__tests__/dsm-derived-bounds-fonsica.test.ts` covers the registration-layer branch.

So Fonsica's runtime row still showing `geo_to_dsm_transform = null` and `dsm_tile_bounds_missing_from_google_solar_metadata` is a **wiring/validation gap**, not a missing feature. This plan closes the remaining gaps required by the spec and proves it end-to-end.

## Gaps to Close

### 1. Verify why the gate doesn't fire on Fonsica

Trace once and decide which is true:

- (a) `raster_bounds_lat_lng` is not on `reg`/`geometry` at hoist time → fix by also reading `transform_package.raster_bounds_lat_lng` and `reg.transform_package.raster_bounds_lat_lng` in `_rasterBoundsForDerivation` lookup.
- (b) `raster_mpp` is missing on geometry → also read `reg.transform_package.raster_meters_per_pixel`.
- (c) `target_mask_overlap_with_perimeter` was nested under a different key → already covered, but extend the lookup to also accept `g.aerial_candidate_roof_graph.target_mask_overlap_with_perimeter`.
- (d) `dsm_pixel_transform_valid` consistency check rejected the derivation — instrument the rejection reasons (already persisted as `dsm_derived_bounds_rejection_reasons`) into the v1 diagnostic surface so we can see this from the report.

### 2. Add full v1 diagnostic surface

Persist these on `reg` (and mirror into `geometry_report_json.dsm_registration`) — currently only some exist:


| Field                                 | Status                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `derived_bounds_enabled`              | NEW — mirrors `_allowDerivedBounds`                                                                                      |
| `derived_bounds_policy`               | NEW — `dsm-registration-derived-bounds-v1`                                                                               |
| `derived_bounds_gate_inputs`          | NEW — `{dsm_loaded, raster_bounds_present, raster_mpp, frame_mismatch_ok, target_mask_overlap}`                          |
| `derived_bounds_validation_passed`    | NEW — true when `dsm_pixel_transform_valid && dsm_tile_bounds_contain_confirmed_center && roundtrip_ok`                  |
| `derived_bounds_validation_failures`  | NEW — array (reuse `dsm_derived_bounds_rejection_reasons` + roundtrip token)                                             |
| `dsm_raster_roundtrip_error_px`       | NEW — see step 3                                                                                                         |
| `confirmed_roof_center_dsm_px_source` | exists in `transformPkg` — ensure it surfaces as `"raster_center_to_geo_to_dsm"` for the derived branch                  |
| `geo_to_dsm_transform_source`         | exists — ensure it reads `"derived_raster_bounds+dsm_size_px"` when `dsm_bounds_source === "derived_from_raster_bounds"` |
| `dsm_to_raster_transform_source`      | exists — ensure it reads `"geo_to_dsm_transform+geo_to_raster_transform"` for derived branch                             |
| `dsm_validation_status`               | NEW shape `{available, reason}` — `reason = "derived_bounds_validated"` on success                                       |


### 3. Add roundtrip validation

Compute `dsm_raster_roundtrip_error_px`:

- Take `confirmed_roof_center_px = [640,640]`.
- Map raster_px → geo via `geo_to_raster_transform⁻¹` → dsm_px via `geo_to_dsm_transform` → back to raster_px via `dsm_to_raster_transform`.
- Euclidean distance from start. Reject derivation if `> 8 px`. Append `dsm_raster_roundtrip_exceeds_threshold` to `derived_bounds_validation_failures` on reject (matches existing consistency-rejection branch — extend it).

### 4. Keep customer gates closed

No changes to:

- `customer_report_ready` gates
- reportable roof line promotion
- aerial candidate graph builder
- CPU containment / preempt resolver
- DB schema
- overlay transform resolver
- UI / report renderer / styling

On success, the new state is: `geo_to_dsm_px_success=true`, `dsm_pixel_transform_valid=true`, `dsm_validation_status.reason="derived_bounds_validated"`, but `customer_report_ready` and reportable line count stay unchanged until topology/pitch/facets/benchmark gates pass independently.

### 5. Tests

Add two regression tests:

**a) `supabase/functions/start-ai-measurement/__tests__/derived-dsm-bounds-fonsica-end-to-end.test.ts**` — drives `applyLiveRuntimeHoistToRegistration` (export it if necessary) with the exact Fonsica runtime payload:

- `dsm_loaded=true`, `dsm_size=998×998`, `raster_size=1280×1280`, `raster_bounds_lat_lng` present, `geo_to_raster_transform` present, `frame_mismatch="ok"`, `target_mask_overlap_with_perimeter=0.976`, Google DSM bounds missing.
- Asserts: `dsm_bounds_derived=true`, `dsm_tile_bounds_source="derived_from_raster_bounds"`, `geo_to_dsm_transform != null`, `dsm_to_raster_transform != null`, `confirmed_roof_center_dsm_px != null`, `geo_to_dsm_px_success=true`, `dsm_pixel_transform_valid=true`, `derived_bounds_enabled=true`, `derived_bounds_policy="dsm-registration-derived-bounds-v1"`, `derived_bounds_validation_passed=true`, `derived_bounds_validation_failures=[]`, `dsm_raster_roundtrip_error_px < 8`, `dsm_validation_status.reason="derived_bounds_validated"`.
- Negative assertions: `customer_report_ready` remains `false`, reportable roof line count remains `0`.

**b) Extend `dsm-derived-bounds-fonsica.test.ts**` with a roundtrip-failure case: feed misaligned `raster_bounds_lat_lng` so the roundtrip exceeds 8 px → assert derivation rejected, `derived_bounds_validation_failures` contains `dsm_raster_roundtrip_exceeds_threshold`, `dsm_tile_bounds_source="derived_rejected_consistency_failure"`, original `dsm_tile_bounds_missing_from_google_solar_metadata` token restored.

## Files Touched

- `supabase/functions/_shared/dsm-registration.ts` — no behavior change; export an optional `dsm_validation_status` helper, keep existing API stable.
- `supabase/functions/start-ai-measurement/index.ts` — `applyLiveRuntimeHoistToRegistration`: extend gate-input lookups, add v1 diagnostic fields, add roundtrip validation step, extend consistency-rejection block to include roundtrip failure.
- `supabase/functions/_shared/source-registration-transform.ts` — add `confirmed_roof_center_dsm_px_source` / `geo_to_dsm_transform_source` / `dsm_to_raster_transform_source` string tags for the derived branch if not already exact.
- `supabase/functions/start-ai-measurement/__tests__/derived-dsm-bounds-fonsica-end-to-end.test.ts` — NEW.
- `supabase/functions/_shared/__tests__/dsm-derived-bounds-fonsica.test.ts` — extended with roundtrip-failure case.

## Out of Scope

UI, report renderer, customer report ready, reportable line promotion, aerial graph builder, CPU policy, DB schema, overlay transform resolver. Topology / pitch / facets / benchmark gates remain the next unlock, not this one.

## Acceptance

Next Fonsica run shows:

- `dsm_bounds_derived=true`, `dsm_tile_bounds_source="derived_from_raster_bounds"`
- `geo_to_dsm_transform`, `dsm_to_raster_transform`, `confirmed_roof_center_dsm_px` all populated
- `geo_to_dsm_px_success=true`, `dsm_pixel_transform_valid=true`
- `derived_bounds_enabled=true`, `derived_bounds_validation_passed=true`, `dsm_raster_roundtrip_error_px` numeric and small
- `dsm_validation_status.reason="derived_bounds_validated"`
- Phase 3A.5 / topology no longer blocked by missing DSM transform
- `customer_report_ready=false` and reportable lines `=0` (unchanged)  
  
Approve this plan. This is the correct next backend move. It is not a new feature from scratch — it finishes wiring the derived DSM fallback that already exists in the repo.
  Send this:
  ```

  ```
  ```
  Go.

  Implement Controlled Derived DSM Bounds Fallback v1 — Finish the Wiring exactly as scoped.

  This is backend DSM registration wiring only.

  Do not touch:
  - UI
  - report renderer
  - customer_report_ready gates
  - reportable roof line promotion
  - aerial candidate graph builder
  - CPU containment / preempt policy
  - DB schema
  - overlay transform resolver
  - topology/pitch/facet promotion

  Current verified code state:
  - DsmBoundsSource = "derived_from_raster_bounds" already exists.
  - DSM_DERIVED_TRANSFORM_POLICY_VERSION = "dsm-registration-derived-bounds-v1" already exists.
  - buildDsmRegistration already honors allow_derived_bounds.
  - applyLiveRuntimeHoistToRegistration already computes _allowDerivedBounds.
  - buildRegistrationTransformPackage already produces geo_to_dsm_transform, dsm_to_raster_transform, confirmed_roof_center_dsm_px, geo_to_dsm_px_success, dsm_pixel_transform_valid.
  - Existing registration-layer test already covers part of this.

  So this is a wiring/diagnostic/validation completion patch, not a rewrite.

  Required work:

  1. Fix why Fonsica derived gate does not fire.

  Trace and patch the lookup only.

  Make _allowDerivedBounds read from all valid locations:

  raster_bounds_lat_lng:
  - geometry.raster_bounds_lat_lng
  - geometry.registration.raster_bounds_lat_lng
  - geometry.registration.transform_package.raster_bounds_lat_lng
  - geometry.registration_gate.raster_bounds_lat_lng
  - geometry.registration_gate.transform_package.raster_bounds_lat_lng

  raster_mpp:
  - geometry.raster_meters_per_pixel
  - geometry.registration.geo_to_raster_transform.meters_per_pixel
  - geometry.registration.transform_package.geo_to_raster_transform.meters_per_pixel
  - geometry.registration_gate.transform_package.geo_to_raster_transform.meters_per_pixel

  target_mask_overlap_with_perimeter:
  - geometry.target_mask_overlap_with_perimeter
  - geometry.target_mask_isolation.target_mask_overlap_with_perimeter
  - geometry.perimeter_phase0.target_mask_overlap_with_perimeter
  - geometry.aerial_candidate_roof_graph.target_mask_overlap_with_perimeter
  - geometry.dsm_planar_graph_debug.aerial_candidate_roof_graph.target_mask_overlap_with_perimeter

  frame_mismatch:
  - geometry.overlay_transform.frame_mismatch
  - geometry.overlay_debug.frame_mismatch
  - geometry.registration.frame_mismatch
  - geometry.frame_mismatch

  Do not invent new data. Only read from existing runtime payload.

  2. Add full v1 derived-bounds diagnostics.

  Persist on registration and mirror into geometry_report_json.dsm_registration:

  - derived_bounds_enabled
  - derived_bounds_policy = "dsm-registration-derived-bounds-v1"
  - derived_bounds_gate_inputs = {
      dsm_loaded,
      raster_bounds_present,
      raster_mpp,
      frame_mismatch_ok,
      target_mask_overlap
    }
  - derived_bounds_validation_passed
  - derived_bounds_validation_failures
  - dsm_raster_roundtrip_error_px
  - dsm_validation_status = {
      available,
      reason
    }

  On success:
  - dsm_validation_status.available = true
  - dsm_validation_status.reason = "derived_bounds_validated"

  On rejection:
  - available = false
  - reason stays or returns to dsm_tile_bounds_missing_from_google_solar_metadata unless a more specific derived rejection applies.

  3. Source tags must be exact.

  When derived branch succeeds, persist:

  - dsm_tile_bounds_source = "derived_from_raster_bounds"
  - dsm_bounds_derived = true
  - dsm_bounds_warning = "google_solar_dsm_bounds_missing_using_raster_bounds_fallback"
  - dsm_transform_policy_version = "dsm-registration-derived-bounds-v1"
  - geo_to_dsm_transform_source = "derived_raster_bounds+dsm_size_px"
  - dsm_to_raster_transform_source = "geo_to_dsm_transform+geo_to_raster_transform"
  - confirmed_roof_center_dsm_px_source = "raster_center_to_geo_to_dsm"

  4. Add roundtrip validation.

  Compute dsm_raster_roundtrip_error_px:

  - start with confirmed_roof_center_px = [640,640]
  - raster_px -> geo using inverse geo_to_raster_transform
  - geo -> dsm_px using geo_to_dsm_transform
  - dsm_px -> raster_px using dsm_to_raster_transform
  - compare returned raster_px to original [640,640]

  Reject if:
  - dsm_raster_roundtrip_error_px > 8

  On rejection:
  - derived_bounds_validation_failures includes "dsm_raster_roundtrip_exceeds_threshold"
  - dsm_tile_bounds_source = "derived_rejected_consistency_failure"
  - restore dsm_registration_failure_token = "dsm_tile_bounds_missing_from_google_solar_metadata"
  - geo_to_dsm_px_success = false
  - dsm_pixel_transform_valid = false

  5. Preserve gates.

  Even if derived registration succeeds:
  - customer_report_ready remains false
  - reportable roof lines remain 0
  - no roof-line promotion
  - no customer report promotion

  This phase only unlocks DSM transform validity and allows topology/pitch/facet stages to proceed later.

  6. Tests.

  Add:

  supabase/functions/start-ai-measurement/__tests__/derived-dsm-bounds-fonsica-end-to-end.test.ts

  Use a Fonsica-shaped runtime payload:
  - dsm_loaded = true
  - dsm_size_px = 998×998
  - raster_size_px = 1280×1280
  - raster_bounds_lat_lng present
  - geo_to_raster_transform present
  - frame_mismatch = "ok"
  - target_mask_overlap_with_perimeter = 0.976
  - Google DSM bounds missing
  - allow_derived_bounds expected true

  Assert:
  - dsm_bounds_derived = true
  - dsm_tile_bounds_source = "derived_from_raster_bounds"
  - geo_to_dsm_transform exists
  - dsm_to_raster_transform exists
  - confirmed_roof_center_dsm_px exists
  - geo_to_dsm_px_success = true
  - dsm_pixel_transform_valid = true
  - derived_bounds_enabled = true
  - derived_bounds_policy = "dsm-registration-derived-bounds-v1"
  - derived_bounds_validation_passed = true
  - derived_bounds_validation_failures = []
  - dsm_raster_roundtrip_error_px < 8
  - dsm_validation_status.reason = "derived_bounds_validated"
  - customer_report_ready remains false
  - reportable roof line count remains 0

  Extend:

  supabase/functions/_shared/__tests__/dsm-derived-bounds-fonsica.test.ts

  Add roundtrip failure case:
  - feed misaligned raster_bounds_lat_lng
  - roundtrip exceeds 8px
  - derivation rejected
  - derived_bounds_validation_failures contains "dsm_raster_roundtrip_exceeds_threshold"
  - dsm_tile_bounds_source = "derived_rejected_consistency_failure"
  - original dsm_tile_bounds_missing_from_google_solar_metadata token restored

  7. Acceptance on next Fonsica run:

  - dsm_bounds_derived = true
  - dsm_tile_bounds_source = "derived_from_raster_bounds"
  - geo_to_dsm_transform populated
  - dsm_to_raster_transform populated
  - confirmed_roof_center_dsm_px populated
  - geo_to_dsm_px_success = true
  - dsm_pixel_transform_valid = true
  - derived_bounds_enabled = true
  - derived_bounds_validation_passed = true
  - dsm_raster_roundtrip_error_px numeric and < 8
  - dsm_validation_status.reason = "derived_bounds_validated"
  - Phase 3A.5 / topology no longer blocked by missing DSM transform
  - customer_report_ready = false
  - reportable lines = 0
  ```
  This is the right unlock. If this passes, the next prompt moves into **topology/pitch/facet validation**, which is the last hard layer before customer-ready measurements.