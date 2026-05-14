## Current state (audit of `start-ai-measurement`)

Most of the patent rules are already wired in `supabase/functions/start-ai-measurement/index.ts`:

- Rule 1 — confirmed roof target: enforced upstream (HTTP 412 `ai_failed_target_unconfirmed`).
- Rule 2 — Layer 1 classification: `classifyLayer1()` runs at line 6111; forbidden sources rejected.
- Rule 3 — typed `roof_lines`: built and inserted at lines 6126–6269 (Layer 1 perimeter line + Layer 2 cleanEdges, typed eave/rake/ridge/hip/valley/wall_flashing/step_flashing/unknown).
- Rule 4 — patent pitch resolver: `pitchSource`/`pitchValid` tracked, per-plane `collapsed_plane_fit` flagged, `solar_fallback` honored.
- Rule 5 — customer-ready gate: `assertCustomerReportReady()` at line 6233 with all 8 inputs (target, Layer 1, allowed source, roof_lines count, typed backing, pitch sources, AI gates, override status).
- Perimeter-only state: 3-state `result_state` derivation at lines 6280–6299 — `customer_report_ready` / `perimeter_only` / `ai_failed_<stage>` — persisted to both `roof_measurements` and `ai_measurement_jobs`.
- Perimeter Phase 0 forced before topology (lines 1826–2172).

## Genuinely missing pieces

1. **Report totals are NOT yet sourced from typed `roof_lines`.** `typedTotals` is computed at line 6193 but only logged. The `roof_measurements.total_eave_length / total_rake_length / total_ridge_length / …` columns and the report generator still use the solver's generic `totals.*`. Patent Rule 3 requires customer totals to come from typed lines.

2. **`recalculate-measurement-from-overrides` edge function does not exist.** The `measurement_overrides` table is in place (columns: `override_kind`, `target_line_id`, `target_plane_id`, `before`, `after`, `override_source`, …) but nothing applies overrides back into a verified measurement.

3. **Admin override editor UI does not exist.** The data path supports it but no UI lets a master/admin edit perimeter / change line attribute / add ridge / override pitch / trigger the recalc.

## Plan

### Step 1 — Totals from typed `roof_lines` (Rule 3 enforcement)

In `start-ai-measurement/index.ts`, immediately after the patent gate succeeds (typed backing `ok`):

- When `typedRoofLines.length > 0` and `backing.ok === true`, overwrite the `roof_measurements` row's `total_eave_length`, `total_rake_length`, `total_ridge_length`, `total_hip_length`, `total_valley_length`, `total_wall_flashing_length`, `total_step_flashing_length`, and `total_unspecified_length` with the values returned by `aggregateLineTotalsByAttribute(typedRoofLines)`.
- When `backing.ok === false`, leave generic totals in place but set `block_customer_report_reason += 'totals_not_typed_backed'` (already happens via patent gate failure).
- Add a `totals_source: 'typed_roof_lines' | 'solver_generic'` field to the `patent_gate` log block in `ai_measurement_jobs.source_context` for forensics.

### Step 2 — `recalculate-measurement-from-overrides` edge function

Create `supabase/functions/recalculate-measurement-from-overrides/index.ts`:

- Input: `{ measurement_id }`, master/admin auth required.
- Load source `roof_lines` rows + all `measurement_overrides` for that measurement, ordered by `created_at`.
- Apply each override in order:
  - `override_kind = 'edit_line_geometry'`: replace `geometry_px` of `target_line_id`, recompute `length_lf`.
  - `override_kind = 'change_line_attribute'`: replace `non_dimensional_attribute` of `target_line_id`.
  - `override_kind = 'add_line'`: insert new typed line from `after`.
  - `override_kind = 'delete_line'`: mark `can_be_customer_reported = false` (soft delete).
  - `override_kind = 'override_pitch'`: update `roof_planes` pitch on `target_plane_id`.
- Recompute totals via `aggregateLineTotalsByAttribute()`.
- Re-run `assertCustomerReportReady()` with `override_validation_status: 'verified'`.
- Write totals back to `roof_measurements`, set `result_state = 'customer_report_ready'` (or keep `perimeter_only` if still failing) and clear `block_customer_report_reason`.
- Stamp `verified_by_override = true`, `verified_at = now()`, `verified_by = auth.uid()`.

### Step 3 — Minimal admin override UI

Add `src/components/measurement/MeasurementOverrideEditor.tsx`:

- Master/admin only (gated by `useUserRole`).
- Loads `roof_lines` for the measurement, draws them over the satellite tile.
- Side panel lists each line with: attribute dropdown, length (read-only), delete button.
- "Add line" tool — click two points to insert a new typed line.
- "Override pitch" — per-plane numeric input.
- "Save & recalculate" calls `recalculate-measurement-from-overrides`.
- Each save inserts a `measurement_overrides` row capturing `before`/`after` then triggers recalc.

Wire a "Edit measurement" button into the existing measurement detail / diagnostic view, visible only to master/admin.

## Acceptance for Fonsica

- AI Measurement still fails fast without confirmed roof target.
- `roof_measurements.total_eave_length` / `total_rake_length` come from `roof_lines` rows when patent gate passes.
- Master can open the override editor, change a line type, save, and see `result_state` flip to `customer_report_ready` without re-running AI.
- `result_state = 'perimeter_only'` continues to disable PDF export downstream.

## Out of scope for this drop

- Drag-vertex polygon editing for perimeter (will use add/delete-line + attribute change for v1).
- Automatic re-run of pitch resolver from edited geometry (pitch override is manual numeric in v1).