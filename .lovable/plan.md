# DSM Diagnostic Propagation — Read-Side Only

**Not** a DSM transform fix. **Not** a topology fix. **Not** a customer-ready fix.
This only exposes diagnostic fields that `start-ai-measurement` already writes into `geometry_report_json.registration` so the runtime payload and Measurement Report dialog stop showing the old generic `invalid_transform` shape.

## Scope

**Allowed files (only these three):**
1. `supabase/functions/debug-measurement-runtime/index.ts`
2. `src/components/measurements/MeasurementReportDialog.tsx`
3. `supabase/functions/debug-measurement-runtime/__tests__/dsm-diagnostic-propagation.test.ts` (new)

**Out of scope (do not touch):** `start-ai-measurement`, `dsm-registration.ts`, `source-registration-transform.ts`, `registration-stage-classifier.ts`, autonomous graph solver, DSM solver internals, topology execution, facets, pitch, `customer_report_ready`, reportable roof line gates, DB schema/migrations, aerial graph builder, CPU containment, overlay transforms, six-phase cleanup.

## Changes

### 1. `debug-measurement-runtime/index.ts` — extend `summarizeRegistration`

Pure passthrough. No derivation. No mutation. Keep all existing keys for backward compatibility.

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
  dsm_hoist_failure_tokens,
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
  coordinate_space_audit,
  candidate_rejection_reason,
}
```

### 2. `MeasurementReportDialog.tsx` — add diagnostic rows

In the existing registration diagnostics block, add rows (with `"—"` fallback) reading from `registrationGate.dsm?.<field>` and `registrationGate.stage_classifier?.<field>`:

- DSM Size
- DSM Bounds Source
- DSM Bounds Failure
- DSM Bounds Derived
- DSM Bounds Confidence
- DSM Meters/Pixel
- geo_to_dsm_transform_source
- dsm_to_raster_transform_source
- confirmed_roof_center_dsm_px_source
- DSM Transform Policy
- DSM Hoist Failure Tokens
- Stage Hard Fail
- Stage Failure Stage

No changes to pass/fail logic, customer-report readiness, manual approval gating, Aerial Candidate Graph row, Debug Roof Lines, or Reportable Roof Lines.

### 3. New test — `dsm-diagnostic-propagation.test.ts`

**Case 1 (failure side — Fonsica shape):** synthetic row with `dsm_size_px={width:998,height:998}`, `dsm_tile_bounds_lat_lng=null`, `dsm_tile_bounds_failure_reason="geotiff_missing_tiepoints"`, `dsm_bounds_source=null`, hoist tokens include `"dsm_tile_bounds_missing_from_google_solar_metadata"`, `dsm_transform_policy_version="dsm-registration-transform-v1"`, `confirmed_roof_center_dsm_px_source="derived_from_raster_center"`, `stage_hard_fail_reason="dsm_tile_bounds_missing_from_google_solar_metadata"`, `dsm_pixel_transform_valid=false`.

Assert `summarizeRow` returns: `registration.present=true`; all the above fields project verbatim into `registration.dsm` / `registration.stage_classifier`; `registration.dsm_pixel_transform_valid=false`; `manual_approval_allowed=false`; `customer_report_ready=false`; `result_state` unchanged; no phase block flips.

**Case 2 (success side):** synthetic row where DSM bounds + transforms exist. Assert `dsm_tile_bounds_lat_lng`, `dsm_tile_bounds_source`, `geo_to_dsm_transform_source`, `dsm_to_raster_transform_source`, `confirmed_roof_center_dsm_px_source` all project through; failure tokens null/absent; no customer-ready behavior changes.

Run via `supabase--test_edge_functions` filtered to `debug-measurement-runtime`.

## Acceptance

- `debug-measurement-runtime` on the latest Fonsica row returns a populated `registration.dsm` block and `registration.stage_classifier.stage_hard_fail_reason="dsm_tile_bounds_missing_from_google_solar_metadata"`.
- Dialog visibly shows DSM Bounds Source, DSM Bounds Failure, DSM Transform Policy, Stage Hard Fail.
- `customer_report_ready` stays `false`, `result_state` unchanged, no new topology phase executed.
- Aerial Candidate Graph still "executed (12 candidate edges)", Reportable Roof Lines still 0.
- All existing edge-function tests pass; new propagation test passes.

Next prompt (not now): Option B — controlled derived DSM bounds fallback, unless diagnostics reveal Google Solar has usable DSM bounds hidden elsewhere.
