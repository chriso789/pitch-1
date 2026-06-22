## PR A — Outline Unlock / No More Runtime Timeout

Goal: when DSM registration is missing but aerial/raster registration is valid (current Fonsica state), the selected raster_px perimeter must be persisted, editable, manually approvable, and the run must stop cleanly **before** topology — never burning 108s of CPU. `customer_report_ready` stays `false`. Phase 3A.5 refinement, Canny snapping, and outline quality work are explicitly out of scope here.

### Files touched

Backend (edge functions)
1. `supabase/functions/_shared/dsm-derived-bounds-runtime.ts`
   - Add `tryDeriveDsmRegistrationFromRaster(input)` returning either a derived registration package or an explicit `{ status: 'unavailable_but_aerial_perimeter_editable', reason }`.
   - Gate conditions (ALL required to derive): DSM grid w/h present; raster bounds present; `geo_to_raster_transform` present; `selected_candidate_polygon_px` present in `raster_px`; `target_mask_overlap_with_perimeter >= 0.95`; `confirmed_roof_center_px` exists and falls inside/near the selected raster candidate.
   - On success stamp: `dsm_bounds_source='derived_from_registered_raster'`, `dsm_bounds_derived=true`, `dsm_bounds_confidence` (0.70–0.85 based on overlap), `dsm_registration_source='derived_registered_raster_fallback'`, `geo_to_dsm_transform_source='derived_from_raster_bounds'`, `dsm_to_raster_transform_source='derived_from_raster_bounds'`.
   - On fail: return `dsm_registration_status='unavailable_but_aerial_perimeter_editable'` plus a machine-readable reason — never fabricate.

2. `supabase/functions/_shared/dsm-registration.ts` / `source-registration-transform.ts`
   - When upstream returns no DSM bounds, call the new derivation helper.
   - Persist the new status fields on the registration result object so downstream consumers and the frontend can read them without re-deriving.

3. `supabase/functions/_shared/registration-gate.ts` + `candidate-hoist.ts` + `phase3a5-coordinate-contract.ts`
   - Add the coordinate-space guard: when `selected_candidate_polygon_px.coord_space === 'raster_px'`, compute centroid offset against `confirmed_roof_center_px` in raster_px. Do NOT compare raster polygons to DSM-space centers when `confirmed_roof_center_dsm_px` is missing.
   - Emit: `candidate_coordinate_space`, `center_used_for_candidate_check`, `centroid_offset_px` (same-frame), `raster_candidate_check_passed`, `confirmed_center_inside_candidate_raster`, `dsm_candidate_check_skipped=true` when DSM transform missing, `confirmed_center_inside_candidate_dsm=null`.
   - Remove the mixed-space failure path that produced the bogus 878px offset.

4. `supabase/functions/start-ai-measurement/index.ts` — early CPU stop guard
   - After registration + candidate gate, BEFORE entering `solveAutonomousGraph` / DSM topology solver:
     - If DSM transform is invalid OR `dsm_registration_status === 'unavailable_but_aerial_perimeter_editable'` OR remaining CPU budget < reserve OR `estimated_work_units >= topology_pixel_limit`: persist the selected raster perimeter + Phase 3A debug roof lines + registration diagnostics, then short-circuit with:
       - `result_state='perimeter_only'` if raster candidate gate passed, else `ai_failed_source_acquisition`
       - `hard_fail_reason='dsm_registration_unavailable'` (or correct perimeter-stage token)
       - `block_customer_report_reason='dsm_registration_unavailable'`
       - `customer_report_ready=false`
       - `diagram_render_intent='perimeter_only'` (raster gate passed) or `'rejected_only'` (gate failed)
     - Route through `normalizeResultStateForWrite()` — extend the mapping only, do not touch the CHECK constraint.
   - Ensure the selected/refined-or-raw raster_px perimeter + debug Phase 3A roof lines are persisted on every short-circuit path.

5. `supabase/functions/_shared/result-state.ts`
   - Extend the normalizer map: `dsm_registration_unavailable → perimeter_only` when raster gate passed; otherwise → `ai_failed_source_acquisition`.

6. `supabase/functions/start-ai-measurement/index.ts` + repo-wide
   - Remove any live runtime read of `roof_measurement_benchmarks` from the canonical route. Rename surviving debug fields: `benchmark_sanity_ok → offline_audit_sanity_ok`, `benchmark_area_sqft → offline_audit_area_sqft`. The benchmark table remains offline-audit only (already memory rule).

7. `supabase/functions/verify-perimeter-manually/index.ts`
   - Loosen the precondition: allow manual approval when `raster_candidate_check_passed=true` AND aerial overlay is valid, even if DSM registration is missing.
   - Write `user_verified_perimeter=true` + the saved raster_px polygon. Explicitly hold `customer_report_ready=false`.

Frontend
8. `src/components/measurements/MeasurementVisualQAOverlay.tsx`
   - Stop disabling "Approve perimeter" when the only failure is DSM registration. Use the new `dsm_registration_status` + `raster_candidate_check_passed` fields.
   - Show inline note: "DSM registration unavailable — manual approval saves the aerial perimeter and unlocks a rerun. DSM / topology / pitch self-consistency must still pass before a customer report can be generated."
9. `src/components/measurements/MeasurementReportDialog.tsx`
   - Replace any "vendor gate" / "vendor parity" wording with "self-consistency gates".
   - Render the new `dsm_registration_status` and `hard_fail_reason='dsm_registration_unavailable'` as a perimeter-only banner (not a runtime error).
10. `src/hooks/useMeasurementJob.ts` (read-only field consumers)
    - Surface new fields: `dsm_registration_status`, `raster_candidate_check_passed`, `candidate_coordinate_space`, `dsm_candidate_check_skipped`.

Tests (required this PR)
11. `supabase/functions/_shared/__fixtures__/fonsica-dsm-missing.json`
    - Exact diagnostic payload: 998×998 DSM, no `dsm_tile_bounds_lat_lng`, raster bounds present, confirmed center `[640,640]`, selected raster polygon from the user's diagnostic (6 vertices + closing), `target_mask_overlap_with_perimeter=0.976`.
12. `supabase/functions/_shared/__tests__/dsm-derived-bounds-runtime.test.ts`
    - Fonsica fixture → derivation succeeds with `dsm_bounds_source='derived_from_registered_raster'` AND confidence in [0.70, 0.85].
    - Synthetic low-overlap fixture (overlap=0.6) → returns `unavailable_but_aerial_perimeter_editable`, no fabricated bounds.
13. `supabase/functions/_shared/__tests__/registration-gate-coordinate-space.test.ts`
    - Raster_px polygon + missing DSM center → `raster_candidate_check_passed=true`, `dsm_candidate_check_skipped=true`, centroid offset < 20 px (not 878 px).
14. `supabase/functions/start-ai-measurement/__tests__/cpu-stop-guard-dsm-missing.test.ts`
    - DSM transform missing → solver never invoked; row persists `result_state='perimeter_only'`, `hard_fail_reason='dsm_registration_unavailable'`, `customer_report_ready=false`, selected raster perimeter present, Phase 3A debug roof lines present, no `ai_measurement_cpu_timeout`.
15. `supabase/functions/verify-perimeter-manually/__tests__/manual-approval-dsm-unavailable.test.ts`
    - DSM missing + raster gate passed → approval succeeds, writes `user_verified_perimeter=true`, `customer_report_ready` remains `false`.
16. Repo grep regression (vitest): no runtime import of `roof_measurement_benchmarks` from `supabase/functions/start-ai-measurement/**`; no UI string match for `/vendor gate/i`.

### Acceptance (matches user's checklist)
- Selected raster_px perimeter editable when DSM registration is missing.
- No mixed-space candidate check.
- No 108s timeout — pipeline stops before topology when DSM transform unavailable.
- `customer_report_ready` remains `false`.
- `hard_fail_reason='dsm_registration_unavailable'` (or correct perimeter-stage token), never `ai_measurement_cpu_timeout` on the DSM-missing path.
- UI copy says "self-consistency gates".
- All 6 test files green.

### Explicitly NOT in this PR
- Phase 3A.5 reorder / aerial-safe refinement.
- Canny edge snapping / corner snap metric population.
- Outline quality refinement against target mask component.
- Full Fonsica regression harness beyond the fixtures above (PR C).
- Any pitch / topology / customer-ready gate change.

### Migration
- One migration: add columns if not already present — `dsm_registration_status text`, `raster_candidate_check_passed boolean`, `candidate_coordinate_space text`, `dsm_candidate_check_skipped boolean` on `roof_measurements`, `ai_measurement_jobs`, `measurement_jobs` (all `IF NOT EXISTS`). Trailing `NOTIFY pgrst, 'reload schema';`. No CHECK constraint changes.

Approve and I'll start with the migration, then ship the backend + frontend + tests in one batch.
