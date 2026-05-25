## Goal
Deploy commit `09e2df70c75e7ec3a2a14927f19fc30c3d1bfae4` (AbortController + terminal-write guard + watchdog), clean up the stuck Fonsica job `6d93693d-9ade-4f20-ab32-9768ffcb9ce8`, then rerun 4063 Fonsica Avenue and report the full diagnostic field set.

## Pre-flight
1. Confirm workspace HEAD = `09e2df70c75e7ec3a2a14927f19fc30c3d1bfae4` (`git rev-parse HEAD`).
2. Confirm the new code is present in source:
   - `AbortController` wired into `fetchRoofMaskFromGoogleSolar`, `fetchDsmFromGoogleSolar`, and Google Solar `dataLayers` fetch
   - 20s timeout option threaded into Google Solar fetch helpers
   - Top-level `try/finally` terminal-write guard in `start-ai-measurement` handler
   - New watchdog edge function (service-role-protected) for stale running jobs > 120s
3. Run the new regression tests via `supabase--test_edge_functions` (must show the 34 passing).

## Step 1 — Deploy
- `supabase--deploy_edge_functions` for:
  - `start-ai-measurement`
  - the new watchdog function (whatever name commit `09e2df7` introduced — to be confirmed by reading the commit's file list)
- Verify deploy success; capture deployment ID + timestamp.

## Step 2 — Clean up the stuck job
Stuck job `6d93693d-9ade-4f20-ab32-9768ffcb9ce8` needs to be marked terminal. Since `psql` is select-only, this requires a **one-off migration** (`supabase--migration`) that updates exactly that row:

```sql
update public.ai_measurement_jobs
set status = 'failed',
    hard_fail_reason = 'ai_measurement_runtime_timeout',
    report_blocked = true,
    needs_review = true,
    updated_at = now()
where id = '6d93693d-9ade-4f20-ab32-9768ffcb9ce8'
  and status in ('running','processing','queued');
```
(Mirror onto `measurement_jobs` / `roof_measurements` only if a matching row exists — verified first with `supabase--read_query`.)

Alternative if a watchdog function was just added: invoke it once with the service-role secret to drain stale rows, then verify Fonsica's row is now terminal.

## Step 3 — Verify no stale "running" Fonsica row
`supabase--read_query` on `ai_measurement_jobs` filtered to the Fonsica lead / address — assert the latest row is terminal before rerun.

## Step 4 — Rerun
Invoke `start-ai-measurement` via `supabase--curl_edge_functions` with the Fonsica lead payload (address `4063 Fonsica Avenue, North Port, FL 34286`, confirmed roof-target coords from prior runs at `27.0820246, -82.1962156`). Capture the new `job_id`.

Poll until terminal or 180s, whichever first.

## Step 5 — Pass/Fail evaluation
**Pass** if:
- Runtime < 180s AND terminal state written
- `hard_fail_reason` ∈ {`google_solar_mask_timeout`, `google_solar_roof_mask_missing`, `roof_mask_footprint_extraction_failed`, `roof_mask_points_missing`, `ai_measurement_runtime_timeout`, `dsm_bounds_missing`, `candidate_centroid_offset_exceeds_target`, `coordinate_space_mismatch`} OR clean success with all gates passed
- `customer_report_ready` is `false` for any failed/debug row; `true` only after `assertCustomerReportReady`

**Fail** if:
- Job still `running` after 180s
- Reaches the 8-minute safety limit
- Generic `coordinate_registration_failed` returns
- `customer_report_ready=true` on a debug-only row

## Step 6 — Report
Query the resulting `ai_measurement_jobs` + `roof_measurements` row and emit all 30 requested fields:
- Top: deployed commit SHA, deployment timestamp, stuck-job cleanup result, new job_id, new measurement_id, runtime_seconds, status, status_message, result_state, hard_fail_reason, block_customer_report_reason, customer_report_ready, diagram_render_intent, roof_lines_count
- `geometry_report_json.source_acquisition_debug.google_solar_mask_stage`: google_solar_status, google_solar_error, google_solar_stage_duration_ms, google_solar_fetch_duration_ms, dsm_fetch_duration_ms, dsm_loaded, mask_loaded, mask_point_count, footprint_point_count, footprint_extraction_duration_ms, footprint_extraction_error
- `geometry_report_json.registration`: dsm_hoist_called, dsm_size_px, dsm_tile_bounds_lat_lng, geo_to_dsm_transform, dsm_to_raster_transform, selected_candidate_polygon_px_present, coordinate_registration_gate_passed

## Notes
- One migration only (the targeted stuck-job update). No schema changes.
- No frontend changes.
- If the rerun returns generic `coordinate_registration_failed` again, follow the prior plan's Step 5: inspect `registration-stage-classifier.ts` and patch the fallback to emit the most specific token before the generic case — but **report first, patch second**.
