## Goal

Unlock DSM registration when Google Solar omits `dsm_tile_bounds_lat_lng`, by deriving an approximate DSM georegistration from the already-aligned raster bounds. Gate strictly; never promote `customer_report_ready` from this path.

## Scope guardrails (do NOT touch)

CPU containment, aerial graph builder, perimeter extraction, raster overlay transforms, customer-report gates, UI stage grouping, DB schema, reportable-line promotion.

## What already exists

- `_shared/dsm-registration.ts` already supports `allow_derived_bounds` with two derivation modes (`derived_from_confirmed_center_and_mpp`, `derived_from_dsm_bbox_and_static_mpp`) and writes `dsm_bounds_derived`, `dsm_bounds_warning`, `dsm_bounds_confidence`.
- `start-ai-measurement/index.ts` calls `buildDsmRegistration({ allow_derived_bounds: false })` at both hoist sites (lines ~1471 and ~6415).
- `_shared/source-registration-transform.ts` builds `geo_to_dsm_transform`, `dsm_to_raster_transform`, and reports `geo_to_dsm_px_success` / `dsm_pixel_transform_valid` / `confirmed_center_inside_candidate` — these flip automatically once `dsm_tile_bounds_lat_lng` is populated.

So the unlock is: (1) add a new explicitly-tagged derivation mode keyed on raster bounds, (2) flip the hoist sites to allow derivation under tight gates, (3) wire diagnostics for `dsm_bounds_source = derived_from_raster_bounds` and `dsm_transform_policy_version = dsm-registration-derived-bounds-v1`, (4) add consistency rejection, (5) leave customer-report gate untouched.

## Implementation

### 1. Add derivation mode `derived_from_raster_bounds` in `_shared/dsm-registration.ts`

- Extend `DsmTileBoundsSource` union with `"derived_from_raster_bounds"`.
- Add new input fields: `rasterBoundsLatLng?: Bounds | null`, `rasterSizePx?: SizePx | null`.
- Add a third derivation branch (after the existing two), only fires when:
  - `dsm_size_px` is present
  - `rasterBoundsLatLng` and `rasterSizePx` are present and finite
  - the two prior derivation branches did not fire
- Derivation math: DSM covers the same geographic footprint as the raster (centered, scaled by `dsm_size_px / raster_size_px`). Output `dsm_tile_bounds_lat_lng` = rasterBoundsLatLng (since the DSM raster shares the Solar tile footprint), and set `dsm_meters_per_pixel = rasterMpp * (raster_size_px.width / dsm_size_px.width)` if not already set.
- Set:
  - `dsm_bounds_source = "derived_from_raster_bounds"`
  - `dsm_bounds_derived = true`
  - `dsm_bounds_warning = "derived_bounds_lower_confidence"`
  - `dsm_bounds_confidence = "low"` (numeric, e.g. 0.6)
- Do NOT push `dsm_tile_bounds_missing_from_google_solar_metadata` when derivation succeeded; instead push an info token `dsm_tile_bounds_derived_from_raster_bounds`.

### 2. Add transform policy tag

In `_shared/source-registration-transform.ts` (or alongside): export `DSM_DERIVED_TRANSFORM_POLICY_VERSION = "dsm-registration-derived-bounds-v1"` and have the diagnostic writer emit it on `registration.dsm.transform_policy_version` (and mirror surfaces) whenever `dsm_bounds_derived === true`.

### 3. Flip hoist sites in `start-ai-measurement/index.ts` (lines ~1471, ~6415)

- Pass `allow_derived_bounds: true`, plus the new `rasterBoundsLatLng` and `rasterSizePx` already available on `reg`/`g`.
- Gate at the caller: only allow derivation when ALL of:
  - `dsmLoaded === true`
  - `reg.dsm_tile_bounds_lat_lng == null` after metadata read
  - `reg.raster_bounds_lat_lng != null`
  - `rasterMpp` finite
  - raster overlay alignment passed (`frame_mismatch_ok === true` / existing alignment flag)
  - `target_mask_overlap_with_perimeter >= 0.90`

  If any precondition fails, keep `allow_derived_bounds: false` and current `dsm_tile_bounds_missing_from_google_solar_metadata` behavior.

### 4. Consistency validation (reject bad derivations)

After `buildSourceRegistrationTransform` runs with the derived bounds, validate:
- `confirmed_center_inside_candidate` becomes `true`
- `perimeter_vs_mask_iou` does not regress below pre-derivation value (snapshot before/after)
- DSM↔raster reprojection round-trip error on the confirmed center ≤ 5 px (compute via the new transforms)

If validation fails: revert `dsm_tile_bounds_lat_lng` to `null`, set `dsm_bounds_source = "derived_rejected_consistency_failure"`, push token `dsm_derived_bounds_rejected_<reason>`, and keep the existing `dsm_tile_bounds_missing_from_google_solar_metadata` failure surface.

### 5. Diagnostic surfaces

`_shared/dsm-diagnostic-propagation.ts` must mirror to all six existing surfaces:
- `dsm_bounds_derived: true`
- `dsm_bounds_source: "derived_from_raster_bounds"`
- `dsm_bounds_confidence`
- `dsm_transform_policy_version: "dsm-registration-derived-bounds-v1"`
- Failure tokens cleared from the "missing metadata" set when derivation succeeded; new info token surfaced.

### 6. Customer-report gate untouched

`assertCustomerReportReady` / `result_state` normalizer get NO changes. Topology and Phase 3A.5 may now execute because `geo_to_dsm_px_success` / `dsm_pixel_transform_valid` / `confirmed_center_inside_candidate` flip true — but `customer_report_ready` stays `false` until downstream validation gates pass on their own.

## Tests (per AI Measurement Regression Harness)

Add under `supabase/functions/_shared/__tests__/`:

1. `dsm-derived-bounds-fonsica.test.ts` — Fonsica-shaped input with `dsm_tile_bounds_lat_lng=null` + valid raster bounds + mask overlap 0.976 → asserts `dsm_bounds_derived=true`, source=`derived_from_raster_bounds`, policy=`dsm-registration-derived-bounds-v1`, `geo_to_dsm_px_success=true`, `dsm_pixel_transform_valid=true`, `confirmed_center_inside_candidate=true`, and `customer_report_ready=false`.
2. `dsm-derived-bounds-gate-preconditions.test.ts` — each precondition individually false (mask overlap 0.85, missing raster bounds, frame mismatch) → asserts derivation NOT attempted, `dsm_tile_bounds_missing_from_google_solar_metadata` still surfaced.
3. `dsm-derived-bounds-consistency-rejection.test.ts` — derivation runs but reprojection error > 5 px → asserts rejection, original failure token preserved.
4. Update existing `dsm-diagnostic-propagation-fonsica.test.ts` to cover both branches (derived vs metadata-present).

## Acceptance criteria

For a Fonsica re-run after this change:
- `registration.dsm.dsm_bounds_derived = true`
- `registration.dsm.dsm_bounds_source = "derived_from_raster_bounds"`
- `registration.dsm.transform_policy_version = "dsm-registration-derived-bounds-v1"`
- `geo_to_dsm_px_success = true`
- `dsm_pixel_transform_valid = true`
- `confirmed_roof_center_dsm_px` populated
- `confirmed_center_inside_candidate = true`
- `phase3_5` no longer skipped at registration stage (it will likely fail at a new downstream gate — that is expected and out of scope for this prompt)
- `customer_report_ready = false`
- Aerial graph executed (12 candidate edges), CPU < 75000, `frame_mismatch = ok`, reportable lines = 0 — all unchanged
