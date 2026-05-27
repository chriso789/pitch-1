## Problem

The Fonsica runtime shows:

- `dsm_registration_callsite_attempted = early_dsm_registration_before_topology`
- `dsm_registration_callsite_skipped_reason = frame_mismatch_not_ok`
- `derived_bounds_enabled = false`

…even though the same payload has `overlay_transform.frame_mismatch = "ok"`, `coord_space = raster_px`, `target_mask_overlap = 0.976`, DSM loaded at 998×998, raster bounds + geo→raster transform present.

Root cause is narrow: in `supabase/functions/start-ai-measurement/index.ts` (lines 6962–6990) the value handed to `runEarlyDerivedDsmRegistration({ frame_mismatch })` is sourced **only** from `dsmCoordinateMatchDebug.frame_mismatch / match_status / is_valid`. It does not read the overlay transform / registration package frame mismatch, and there is no raster-evidence fallback. So Fonsica fails the strict `frame_mismatch !== "ok"` gate in `_shared/early-dsm-registration.ts:199`.

Secondary UI bugs on the same report:

- `src/lib/measurement/registration-gate.ts` banner still says "Coordinate frame mismatch …" in the wrong branch.
- `MeasurementVisualQAOverlay.tsx` DSM Status card reads only `grj.dsm_size / grj.dsm.size` and misses the `registration.*` / `transform_package.*` / `dsm_split_status.*` paths, so it renders Status: Missing / Size: — even when the report summary has DSM 998×998.

## Scope (do NOT touch)

DSM math, `dsm-registration.ts` algorithms, customer_report_ready gates, reportable roof line promotion, topology / pitch / facet promotion, DB schema, CPU containment policy, aerial graph builder.

## Backend changes

### 1. New helper: `_shared/resolveFrameMismatch.ts`

Pure function. Walks the geometry payload in priority order and returns `{ frame_mismatch_ok, frame_mismatch_source, frame_mismatch_raw, raster_registration_evidence }`.

Priority (first explicit string wins; `"ok"` → true, anything else → false):

1. `geometry.overlay_transform.frame_mismatch`
2. `geometry.overlayCoordinateFrame.frame_mismatch`
3. `geometry.visual_qa.overlay_transform.frame_mismatch`
4. `geometry.overlay_debug.frame_mismatch`
5. `geometry.registration.overlay_transform.frame_mismatch`
6. `geometry.registration.transform_package.frame_mismatch`
7. `geometry.registration_gate.overlay_transform.frame_mismatch`
8. `geometry.registration_gate.transform_package.frame_mismatch`
9. `geometry.frame_mismatch`
10. Legacy: `dsmCoordinateMatchDebug.frame_mismatch / match_status / is_valid`

Fallback inference (only when no explicit string found) — `frame_mismatch_ok = true` when ALL hold:

- `coordinate_space_candidate === "raster_px"`
- `coordinate_space_renderer === "raster_px"`
- `source_raster_px || raster_size_px` exists
- `confirmed_center_px` exists
- `raster_bounds_contain_confirmed_center === true`
- `selected_candidate_polygon_px_present === true`
- `target_mask_overlap_with_perimeter >= 0.90`

Source label: `inferred_from_raster_registration_evidence`.

Returns `raster_registration_evidence` object recording each input it checked so we can persist diagnostics.

### 2. Wire helper into early DSM registration callsite

In `supabase/functions/start-ai-measurement/index.ts` around lines 6962–6990:

- Build a `geometryView` object from already-hoisted values (`hoistedTransformPackage`, `perimeterTopologySnapshot`, `targetMaskIsolation`, `overlay_debug`, `registration*` blocks the route already assembles).
- Call `resolveFrameMismatch(geometryView, dsmCoordinateMatchDebug)`.
- Pass `frame_mismatch: result.frame_mismatch_ok ? "ok" : (result.frame_mismatch_raw ?? "mismatch")` into `runEarlyDerivedDsmRegistration` — this preserves the existing `EarlyDsmRegistrationInput.frame_mismatch: string | null` contract with zero shape change to `_shared/early-dsm-registration.ts`.
- Stash the resolution onto a new `derived_bounds_gate_inputs` block:
  ```
  derived_bounds_gate_inputs = {
    frame_mismatch_ok,
    frame_mismatch_source,
    frame_mismatch_raw,
    raster_registration_evidence,
    target_mask_overlap_with_perimeter,
    selected_perimeter_present,
    dsm_loaded, dsm_size_px,
    raster_bounds_present, geo_to_raster_transform_present,
  }
  ```
  Merge this onto `geometry_report_json` and into the early-preempt debug bag alongside the existing `dsm_registration_callsite_*` fields.

This preserves rule "re-run early derived DSM registration if the only previous skip reason was frame_mismatch_not_ok and the corrected gate resolves true" — by virtue of being a single call after correct resolution, no retry plumbing is needed.

### 3. Regression tests

`supabase/functions/start-ai-measurement/__tests__/early-dsm-registration-frame-mismatch-source.test.ts` (new):

- **Fonsica positive (explicit)**: geometry has no top-level `frame_mismatch`, but `overlay_transform.frame_mismatch === "ok"`, full raster + DSM evidence. Asserts:
  - `derived_bounds_gate_inputs.frame_mismatch_ok === true`
  - `frame_mismatch_source === "overlay_transform.frame_mismatch"`
  - early derived registration runs (success branch)
  - skipped_reason absent
  - `dsm_bounds_derived === true`, `dsm_pixel_transform_valid === true`
- **Fonsica positive (inferred)**: no explicit `frame_mismatch` anywhere; raster evidence complete + overlap 0.976. Asserts inferred source label and success.
- **Negative**: explicit `frame_mismatch = "raster_outside_dsm"` and no strong fallback → early registration skipped with `frame_mismatch_not_ok`.

Plus a unit test for `resolveFrameMismatch` covering each of the 10 priority sources.

## Frontend changes (same PR)

### 4. Banner copy — `src/lib/measurement/registration-gate.ts`

`registrationBanner()` already special-cases `frame_mismatch === "ok"` (line ~143–164). Tighten:

- When any of the canonical overlay paths surface `frame_mismatch === "ok"` (use the new `resolveFrameMismatch` logic on the client; mirror as `src/lib/measurement/resolveFrameMismatch.ts`), force the DSM-only copy:
  > **DSM registration incomplete — manual approval locked.** The aerial perimeter is aligned to the satellite image, but DSM georegistration is missing. …
- Never emit "Coordinate frame mismatch — overlay not eligible for manual approval" when frame is OK by any source.

### 5. DSM Status card — `src/components/measurements/MeasurementVisualQAOverlay.tsx` (≈ lines 817–851)

Replace `dsmSize` lookup with a helper that picks the first present:

- `grj.registration.dsm.dsm_size_px`
- `grj.registration.dsm_size_px`
- `grj.registration.transform_package.dsm_size_px`
- `grj.dsm_split_status.dsm_size_px`
- `grj.registration_gate.dsm_size_px`
- legacy `grj.dsm_size`, `grj.dsm.size`

Same fan-out for `dsm_bounds_failure`, `dsm_to_raster_transform_source`, and `dsm_pixel_transform_valid`.

For Fonsica this will render:

```
Status:    Loaded, not registered
Size:      998×998
Bounds:    dsm_tile_bounds_missing_from_google_solar_metadata
Transform: unavailable
Overlay:   suppressed
Policy:    dsm-registration-transform-v1
```

### 6. Frontend tests

Extend `src/lib/measurements/measurementDiagnosticState.test.ts` (or sibling) with:

- DSM Status card resolution from each of the 6 canonical paths.
- `registrationBanner` returns DSM-only copy (not coord-mismatch copy) when any overlay path reports `frame_mismatch === "ok"` but `dsm_pixel_transform_valid === false`.

## Acceptance (next Fonsica run)

- `derived_bounds_gate_inputs.frame_mismatch_ok = true`
- `derived_bounds_gate_inputs.frame_mismatch_source` = `overlay_transform.frame_mismatch` OR `inferred_from_raster_registration_evidence`
- `dsm_registration_callsite_attempted = early_dsm_registration_before_topology`
- No `frame_mismatch_not_ok` skip
- `derived_bounds_enabled = true`, `dsm_bounds_derived = true`, `dsm_tile_bounds_source = derived_from_raster_bounds`
- `geo_to_dsm_transform`, `dsm_to_raster_transform`, `confirmed_roof_center_dsm_px` populated
- `geo_to_dsm_px_success = true`, `dsm_pixel_transform_valid = true`
- `dsm_validation_status.reason = derived_bounds_validated`
- `customer_report_ready` still false; reportable roof lines still 0 (unchanged by this fix)
- Visual QA banner: "DSM registration incomplete — manual approval locked" (not coord-mismatch)
- DSM Status card: Status Loaded, not registered; Size 998×998

## Files touched

Backend:

- `supabase/functions/_shared/resolveFrameMismatch.ts` *(new)*
- `supabase/functions/start-ai-measurement/index.ts` (≈ lines 6960–7010 + nearby diagnostics stash)
- `supabase/functions/start-ai-measurement/__tests__/early-dsm-registration-frame-mismatch-source.test.ts` *(new)*
- `supabase/functions/_shared/__tests__/resolveFrameMismatch.test.ts` *(new)*

Frontend:

- `src/lib/measurement/resolveFrameMismatch.ts` *(new, mirror of backend helper)*
- `src/lib/measurement/registration-gate.ts` (banner branch)
- `src/components/measurements/MeasurementVisualQAOverlay.tsx` (DSM Status card resolution)
- `src/lib/measurements/measurementDiagnosticState.test.ts` (extend)  
  
I reviewed the latest report/PDF carefully. The important thing is: the system is now **one narrow gate-resolution bug away** from actually activating the derived DSM fallback in production.
  The smoking gun is here:
  ```

  ```
  ```
  dsm_registration_callsite_attempted = early_dsm_registration_before_topology
  dsm_registration_callsite_skipped_reason = frame_mismatch_not_ok
  derived_bounds_enabled = false
  ```
  But the same payload says:
  ```

  ```
  ```
  frame_mismatch = ok
  coord_space = raster_px
  target_mask_overlap_with_perimeter = 0.976
  DSM loaded = true
  DSM size = 998×998
  ```
  So:
  -   
  the derived DSM fallback DID try to run  

  -   
  the raster registration is actually aligned  

  -   
  but the early DSM gate is reading the wrong frame mismatch source  

  That means:
  -   
  the DSM math is no longer the problem  

  -   
  the topology engine is no longer the problem  

  -   
  the aerial geometry is no longer the problem  

  The next fix is correctly scoped:  
    
  **resolve frame_mismatch from the same overlay transform source the UI already trusts.**
  The Lovable plan is correct. I approved it and pushed the refined implementation details into the repo issue.