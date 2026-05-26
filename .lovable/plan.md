# DSM Diagnostic Propagation — Read-Side Only

## Goal
Make the new DSM registration diagnostics that `start-ai-measurement` already writes to `geometry_report_json.registration` actually appear in the runtime payload returned by `debug-measurement-runtime` and in the Measurement Report dialog. **No topology, no solver, no DB migration, no behavior change in `start-ai-measurement`.**

## Why this is the right next step
The previous prompt added the source/policy/derivation fields on `reg` inside `applyLiveRuntimeHoistToRegistration` (lines ~1430–1547 of `start-ai-measurement/index.ts`):

- `dsm_tile_bounds_source`, `dsm_tile_bounds_failure_reason`, `dsm_bounds_derived`, `dsm_bounds_warning`, `dsm_bounds_confidence`
- `dsm_meters_per_pixel`, `dsm_mpp_source`
- `dsm_registration_version`, `dsm_registration_source`, `dsm_hoist_failure_tokens`
- `geo_to_dsm_transform_source`, `dsm_to_raster_transform_source`, `confirmed_roof_center_dsm_px_source`
- `dsm_transform_policy_version`
- `stage_hard_fail_reason`, `stage_failure_stage`, `coordinate_space_audit` (from `classifyRegistrationStage`)

Those fields **are persisted** (they ride on `geometry_report_json.registration` via `prepareRoofMeasurementPayload`), but:

- `debug-measurement-runtime/index.ts → summarizeRegistration()` does not project any of them, so the runtime payload still shows the old shape.
- `MeasurementReportDialog.tsx` only reads the legacy fields (`dsm_tile_bounds_lat_lng`, `dsm_pixel_transform_valid`, `dsm_to_raster_transform_exists`, generic `failure_reason`), so the UI still reads "invalid_transform" with no source/policy/derivation context.

That matches the user's report: the diagnostics aren't surfacing into the runtime payload or the UI.

## Out of scope (explicitly)
- No changes to `start-ai-measurement`, `dsm-registration.ts`, `source-registration-transform.ts`, `registration-stage-classifier.ts`, or any solver.
- No derived DSM bounds fallback (that is the *next* prompt — Option B).
- No topology execution, no facets, no pitch, no `customer_report_ready` flip.
- No DB migration. No edge-function deploy beyond `debug-measurement-runtime`.

## Changes

### 1. `supabase/functions/debug-measurement-runtime/index.ts` — extend `summarizeRegistration`
Add a `dsm` sub-object and a `stage_classifier` sub-object to the returned registration summary, projecting the fields straight off `reg`. Pure passthrough — no mutation, no derivation.

```text
registration.dsm = {
  dsm_size_px, dsm_size_source,
  dsm_tile_bounds_lat_lng, dsm_bounds_source, dsm_tile_bounds_source,
  dsm_tile_bounds_failure_reason,
  dsm_bounds_derived, dsm_bounds_warning, dsm_bounds_confidence,
  dsm_meters_per_pixel, dsm_mpp_source,
  dsm_registration_version, dsm_registration_source,
  dsm_stage_attempted, dsm_stage_pending,
  dsm_hoist_called, dsm_hoist_callsite, dsm_hoist_version,
  dsm_hoist_failure_tokens,                  // array | null
  dsm_raster_bounds_overlap, dsm_raster_overlap_ratio,
  dsm_tile_bounds_contain_confirmed_center,
  confirmed_roof_center_dsm_px,
  geo_to_dsm_transform_source,
  dsm_to_raster_transform_source,
  confirmed_roof_center_dsm_px_source,
  dsm_transform_policy_version,
}

registration.stage_classifier = {
  stage_hard_fail_reason,
  stage_failure_stage,
  coordinate_space_audit,                    // pass-through object
  candidate_rejection_reason,
}
```

Keep all the existing top-level keys in `registration` for backward compatibility (do not rename anything that already shipped).

### 2. `src/components/measurements/MeasurementReportDialog.tsx` — add diagnostic rows
In the registration diagnostics block (around lines 440–520), add rows under the existing DSM section, in this order, each value coming from `registrationGate.dsm?.<field>` with a `"—"` fallback so missing fields don't break older rows:

- `DSM Size` → `dsm_size_px`
- `DSM Bounds Source` → `dsm_tile_bounds_source ?? dsm_bounds_source`
- `DSM Bounds Failure` → `dsm_tile_bounds_failure_reason`
- `DSM Bounds Derived` → `dsm_bounds_derived` (+ `dsm_bounds_warning` if present)
- `DSM Bounds Confidence` → `dsm_bounds_confidence`
- `DSM Meters/Pixel` (+ `dsm_mpp_source`)
- `geo_to_dsm_transform_source`
- `dsm_to_raster_transform_source`
- `confirmed_roof_center_dsm_px_source`
- `DSM Transform Policy` → `dsm_transform_policy_version`
- `DSM Hoist Failure Tokens` → joined array
- `Stage Hard Fail` → `registration.stage_classifier?.stage_hard_fail_reason`
- `Stage Failure Stage` → `registration.stage_classifier?.stage_failure_stage`

Pure presentation — no logic changes elsewhere in the dialog.

### 3. New test — `supabase/functions/debug-measurement-runtime/__tests__/dsm-diagnostic-propagation.test.ts`
Build a synthetic `roof_measurements` row whose `geometry_report_json.registration` mirrors the latest Fonsica run (DSM loaded, bounds null, classifier hard-fail = `dsm_tile_bounds_missing_from_google_solar_metadata`, all source fields populated, `dsm_pixel_transform_valid=false`). Run `summarizeRow` and assert:

1. `registration.present === true`
2. `registration.dsm.dsm_size_px` equals `{width:998,height:998}`
3. `registration.dsm.dsm_tile_bounds_lat_lng === null`
4. `registration.dsm.dsm_tile_bounds_failure_reason === "geotiff_missing_tiepoints"`
5. `registration.dsm.dsm_bounds_source === null` (no derivation yet — Option B is the next prompt)
6. `registration.dsm.dsm_hoist_failure_tokens` contains `"dsm_tile_bounds_missing_from_google_solar_metadata"`
7. `registration.dsm.dsm_transform_policy_version === "dsm-registration-transform-v1"`
8. `registration.dsm.confirmed_roof_center_dsm_px_source === "derived_from_raster_center"` (when fallback was used)
9. `registration.stage_classifier.stage_hard_fail_reason === "dsm_tile_bounds_missing_from_google_solar_metadata"`
10. `registration.dsm_pixel_transform_valid === false`
11. `manual_approval_allowed === false`
12. Top-level row contract unchanged: `customer_report_ready` still false, `result_state` unchanged, no phase block flipped.

A second case asserts that when `dsm_tile_bounds_lat_lng` IS present and transforms succeed, the same projection fills with success-side source tags and no failure tokens.

Run via `supabase--test_edge_functions` filtered to `debug-measurement-runtime`.

## Acceptance criteria

- Calling `debug-measurement-runtime` on the latest Fonsica row returns a `registration.dsm` block populated with the new source/policy/failure fields and a `registration.stage_classifier.stage_hard_fail_reason = dsm_tile_bounds_missing_from_google_solar_metadata`.
- The Measurement Report dialog visibly shows DSM Bounds Source, DSM Bounds Failure, DSM Transform Policy, and Stage Hard Fail rows.
- `customer_report_ready` remains `false`, `result_state` unchanged, no topology phase newly executed.
- Aerial Candidate Graph still shows "executed (12 candidate edges)" and Reportable Roof Lines still 0.
- All existing edge-function tests pass; the new propagation test passes.

## Files touched
- `supabase/functions/debug-measurement-runtime/index.ts`
- `src/components/measurements/MeasurementReportDialog.tsx`
- `supabase/functions/debug-measurement-runtime/__tests__/dsm-diagnostic-propagation.test.ts` (new)
