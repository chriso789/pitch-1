
# Measurement Validation Hardening Plan

## Problem

The system detects failures (coverage=75%, validated_faces=0, area ratio=1.49) but still saves and returns measurements. Failed geometry produces inflated numbers that reach the customer-facing report.

## Current State

- `validateAutonomousResult()` in the graph solver has 7 gates (coverage, faces, ridges, etc.)
- `sanityFailures[]` in `start-ai-measurement` collects issues and sets `blockCustomerReportReason`
- When blocked: `report_blocked=true`, `needs_review=true` on `ai_measurement_jobs` and `ai_measurement_results`
- **Gap 1**: No area-ratio gate (adjusted/flat > 1.25 should hard-fail)
- **Gap 2**: No `is_valid` / `fail_reasons` / `area_ratio` columns on `ai_measurement_results`
- **Gap 3**: Results are always inserted — there's no conditional "do not write measurements if validation failed"
- **Gap 4**: No standalone validation edge function for post-hoc re-validation
- **Gap 5**: No frontend debug overlay to visualize footprint vs planes vs edges

## Changes

### 1. Database Migration — Add Validation Columns

Add to `ai_measurement_results`:
- `is_valid boolean default false`
- `fail_reasons text[]`
- `area_ratio numeric` (adjusted / flat)
- `footprint_confidence numeric`
- `coverage numeric`
- `validated_face_count int`
- `total_face_count int`

Add a `validate_measurement` SQL function (as you specified) for reusable server-side validation.

### 2. Edge Function: `start-ai-measurement` — Hard Stop on Bad Geometry

In the result-writing section (~line 3970):
- Compute `area_ratio = total_area_pitch_adjusted_sqft / total_area_2d_sqft`
- Add area ratio sanity gate: if ratio > 1.25, add `AREA_INFLATION` to `sanityFailures`
- Add coverage gate: if autonomous graph coverage < 0.85, add `LOW_COVERAGE`
- Add face validation gate: if validated_faces < total_faces * 0.7, add `INVALID_FACES`
- Populate the new columns (`is_valid`, `fail_reasons`, `area_ratio`, etc.) on every insert
- When `is_valid=false`: still insert the record (for debugging), but zero out all measurement totals in the response and set `report_blocked=true`

### 3. New Edge Function: `validate-measurement`

Create `supabase/functions/validate-measurement/index.ts`:
- Accepts `{ id }` (measurement result ID)
- Reads the record, calls the `validate_measurement` RPC
- Updates `is_valid`, `fail_reasons`, `area_ratio`, `status` on the record
- Returns 400 with failure reasons if invalid, 200 if valid
- This enables post-hoc re-validation of any measurement

### 4. Frontend: Measurement Failure Indicator

In the measurement results UI (where results are displayed after AI measurement completes):
- Check `is_valid` / `report_blocked` / `fail_reasons`
- When invalid: show a red alert banner listing each failure reason with clear labels
- Do NOT display measurement numbers when `is_valid=false` — show "Measurement Failed" instead

### 5. Frontend: Debug Overlay Viewer Component

Create `src/components/measurements/RoofDebugViewer.tsx`:
- Renders footprint polygon (green), plane polygons (orange), edge lines (red) on a Mapbox map
- Accepts geometry data from `ai_measurement_results.report_json`
- Used on the internal review/debug panel for failed measurements
- Shows coverage ratio, face count, area ratio as badges overlay

## Technical Details

- The `validate_measurement` SQL function uses the exact thresholds: coverage < 0.85, validated_faces < 70%, footprint_confidence < 0.9, area_ratio > 1.25
- The area ratio gate in `start-ai-measurement` prevents the 49% inflation case (1.49x) from ever producing customer-visible output
- All validation results are persisted for audit trail
- Existing `report_blocked` / `needs_review` flags continue to work alongside the new `is_valid` flag
