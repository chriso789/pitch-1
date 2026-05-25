## Goal
Confirm commit `a4d543767f5c7a321cc7b24c133803fa01204592` is live on Supabase, then rerun AI Measurement for 4063 Fonsica Avenue and report the full diagnostic field set.

## Pre-flight state (already verified)
- Workspace HEAD = `a4d54376` ✅ (matches required commit)
- New timeout constants present in source (`GOOGLE_SOLAR_STAGE_TIMEOUT_MS=60_000`, fetch/footprint=20_000) ✅
- New failure tokens wired (`google_solar_mask_timeout`, `roof_mask_footprint_extraction_failed`, `roof_mask_points_missing`) ✅
- No stuck/running Fonsica row — last 5 are all terminal `ai_failed_source_acquisition` with the legacy `coordinate_registration_failed` hard_fail_reason, latest at 2026-05-25 00:17 UTC ✅
- That legacy token on the most recent row means the **deployed** edge function is older than `a4d54376`

## Steps

### 1. Force deploy `start-ai-measurement` (and shared modules pulled in via bundling)
Use `supabase--deploy_edge_functions` with `["start-ai-measurement"]`. After deploy, hit the function with a no-op auth probe (or just rely on the rerun) and grep edge logs for the new diagnostic field name `google_solar_stage_duration_ms` to prove the new code path is serving traffic.

### 2. Trigger the rerun
Invoke `start-ai-measurement` for the Fonsica lead (address: `4063 Fonsica Avenue, North Port, FL 34286`). Either:
- via `supabase--curl_edge_functions` with the lead_id payload, or
- ask the user to click "Pull AI Measurement" on the Fonsica lead detail page

The job should complete or hard-fail within ~60s; it must not sit in "Extracting Google Solar roof mask footprint" for 8 minutes.

### 3. Pull the resulting row and assemble the report
Query `roof_measurements` for the newest Fonsica row and extract:

**Top-level columns:**
`id`, `created_at`, `result_state`, `hard_fail_reason`, `block_customer_report_reason`, `customer_report_ready`, `last_failure_stage`, `created_by_function`, `route_audit_version`

**From `geometry_report_json` / `geometry_report_json.source_acquisition_debug.google_solar_mask_stage`:**
`google_solar_status`, `google_solar_error`, `google_solar_stage_duration_ms`, `google_solar_fetch_duration_ms`, `dsm_fetch_duration_ms`, `dsm_loaded`, `mask_loaded`, `mask_point_count`, `footprint_point_count`, `footprint_extraction_duration_ms`, `footprint_extraction_error`

**From `geometry_report_json.registration` (or `.registration_gate`):**
`dsm_hoist_called`, `dsm_size_px`, `dsm_tile_bounds_lat_lng`, `geo_to_dsm_transform`, `dsm_to_raster_transform`, `selected_candidate_polygon_px` (presence), `coordinate_registration_gate_passed`

**Runtime:** `created_at` of job vs row update timestamp.

### 4. Apply pass/fail rule
- **Pass shape:** specific hard_fail_reason from the allow-list (`google_solar_mask_timeout`, `google_solar_roof_mask_missing`, `roof_mask_footprint_extraction_failed`, `roof_mask_points_missing`, `dsm_size_missing`, `dsm_bounds_missing`, `geo_to_dsm_transform_missing`, `dsm_to_raster_transform_missing`, `selected_candidate_polygon_missing`, `candidate_centroid_offset_exceeds_target`, `coordinate_space_mismatch`) OR a clean success with all gates passed before `customer_report_ready=true`.
- **Fail shape:** any of `8_minute_safety_limit`, generic `coordinate_registration_failed`, still-running >120s, or `customer_report_ready=true` on a debug-only row.

### 5. If still generic `coordinate_registration_failed`
Open `registration-stage-classifier.ts` and trace why the new specific-token branches aren't hit — likely the source-acquisition failure path is bypassing the classifier and falling through to a legacy default. Patch the fallback to emit the most specific available token from the google_solar_mask_stage debug block before reaching the generic case.

## Notes
- No DB migrations needed.
- No frontend changes needed for this loop.
- Plan mode → switch to build mode to actually deploy + curl.