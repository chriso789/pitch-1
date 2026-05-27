Scope is narrow: backend frame source resolution + frontend Visual QA/Roof Focus display only. No DSM math, topology, pitch, customer_report_ready, DB schema, CPU policy, aerial graph, or roof-line promotion changes.

## Rules this honors

- Roof Measurement Vision QA Rule 3/11: DSM/topology/customer export stays gated; this only removes a false coordinate-frame block.
- Visual QA Overlay Rule 1/3/4: failed/topology-blocked reports still show aerial-backed diagnostics, not a misleading blank or wrong-frame message.
- Regression Harness Rule 1: add/update tests for the measurement pipeline regression.

## Key finding

The visible Overlay transform table is computing `frame_mismatch = ok` from render/crop evidence, but the backend and banner resolver miss the latest live JSON shape:

- `registration.transform_package.coordinate_space_renderer = raster_px`
- `registration.transform_package.coordinate_space_candidate = raster_px`
- no top-level `frame_mismatch`
- `dsmCoordinateMatchDebug = null`

Current resolver inference does not read those nested `registration.transform_package.*` coordinate-space fields, and `gatherDerivedBoundsGateInputs()` still has its own older frame check instead of the shared resolver. Roof Focus diagnostics also compute `first_pt_disp` as full-raster display coords instead of crop-relative coords.

## Backend plan

1. Update `supabase/functions/_shared/resolveFrameMismatch.ts`
  - Add live payload inference paths:
    - `registration.transform_package.coordinate_space_candidate`
    - `registration.transform_package.coordinate_space_renderer`
    - `registration.transform_package.source_raster_px` / `raster_size_px`
    - `registration.selected_candidate_polygon_px_present`
    - `registration.raster_bounds_contain_confirmed_center`
  - Return source `inferred_from_live_overlay_transform_evidence` for this runtime-shaped evidence set.
  - Keep explicit `overlay_transform.frame_mismatch = ok` as highest priority.
  - Keep `dsmCoordinateMatchDebug` as fallback only; never let null/missing DSM debug override overlay/raster OK.
2. Update `supabase/functions/_shared/dsm-derived-bounds-runtime.ts`
  - Replace the local `frameMismatchRaw === "ok"` logic in `gatherDerivedBoundsGateInputs()` with `resolveFrameMismatch(g, dsmCoordinateMatchDebug)`.
  - Extend `DerivedBoundsGateInputs` to carry:
    - `frame_mismatch_source`
    - `frame_mismatch_raw`
    - `raster_registration_evidence`
  - Ensure `derived_bounds_gate_inputs` can persist the resolved source/raw values.
3. Update `supabase/functions/start-ai-measurement/index.ts`
  - In the early DSM registration callsite, build `_geometryViewForFrame` with the exact same live shape the report JSON uses, including `registration.transform_package.coordinate_space_renderer/candidate` and selected polygon presence.
  - Persist gate diagnostics:
    - `derived_bounds_gate_inputs.frame_mismatch_ok = true`
    - `derived_bounds_gate_inputs.frame_mismatch_source = inferred_from_live_overlay_transform_evidence` or exact explicit source path
    - `derived_bounds_gate_inputs.frame_mismatch_raw = "ok"` when explicit; null for inferred
  - Pass `frame_mismatch: "ok"` into `runEarlyDerivedDsmRegistration()` when resolver says OK.
  - Preserve existing behavior that `customer_report_ready = false` and reportable roof lines remain 0.

## Frontend plan

4. Update `src/lib/measurement/resolveFrameMismatch.ts`
  - Mirror backend resolver paths and source naming exactly.
  - This keeps Visual QA banner and backend gate source-aligned.
5. Update `src/lib/measurement/registration-gate.ts`
  - Keep banner classification driven by the shared frontend resolver.
  - Ensure when resolved frame is OK, the banner cannot say “Coordinate frame mismatch”; it must return the DSM registration incomplete copy.
6. Update `src/components/measurements/MeasurementVisualQAOverlay.tsx`
  - Add an “Overlay Truth” card/row near the banner:
    - `Overlay frame: OK`
    - `Overlay source: <resolved source path>`
    - `DSM transform: missing` or available
    - `Manual approval: locked by DSM registration`
  - Make Overlay transform diagnostics crop-aware in Roof Focus:
    - `source_px`
    - `crop_bbox_px`
    - `display_px_within_crop`
    - `crop_scale`
    - `crop_offset`
  - Fix `first_pt_disp` / bbox center display values to subtract `viewportSrc.minX/minY` before scaling so displayed points are within the visible Roof Focus viewport.
  - Do not alter stored measurement coordinates.

## Regression tests

Test files:

- `supabase/functions/_shared/__tests__/resolveFrameMismatch.test.ts`
- `supabase/functions/start-ai-measurement/__tests__/early-dsm-registration-frame-mismatch-source.test.ts`
- `src/lib/measurement/__tests__/registrationBanner.frame-ok.test.ts`
- Add `src/components/measurements/__tests__/MeasurementVisualQAOverlay.roof-focus-transform.test.tsx` if the existing test setup supports this component; otherwise keep the crop math extracted into a small pure helper and test that helper.

Mock payload shape:

```json
{
  "registration": {
    "transform_package": {
      "coordinate_space_renderer": "raster_px",
      "coordinate_space_candidate": "raster_px",
      "raster_size_px": { "width": 1280, "height": 1280 }
    },
    "raster_bounds_contain_confirmed_center": true,
    "selected_candidate_polygon_px_present": true,
    "confirmed_roof_center_px": [640, 640]
  },
  "target_mask_isolation": {
    "target_mask_overlap_with_perimeter": 0.976
  },
  "dsmCoordinateMatchDebug": null
}
```

Assertions:

- `resolveFrameMismatch(payload).frame_mismatch_ok === true`
- `frame_mismatch_source === "inferred_from_live_overlay_transform_evidence"` or exact explicit overlay path when explicit frame exists
- `gatherDerivedBoundsGateInputs(...).frame_mismatch_ok === true`
- Early DSM result does not skip with `frame_mismatch_not_ok`
- When enough DSM/raster inputs are present, `derived_bounds_enabled === true`
- Registration banner title is `DSM registration incomplete — manual approval locked` when frame OK and DSM transform missing
- Roof Focus projected display point and bbox center are within the visible crop display bounds

Acceptance thresholds:

- Target mask overlap gate remains `>= 0.90`.
- DSM/raster roundtrip gate remains existing `<= 8px`.
- Customer report stays blocked: `customer_report_ready=false`, reportable roof lines `0`.

## Commands I will run after implementation

- `supabase--test_edge_functions` for `start-ai-measurement` / shared Deno tests.
- `bunx vitest run` for the frontend resolver/banner/Roof Focus tests.  
  
I reviewed the latest report/PDF and the Lovable plan is correct. The system is now blocked by a **live source-plumbing mismatch**, not by bad geometry or missing DSM math.
  The report proves:
  - Overlay transform table says:
    - `frame_mismatch = ok`
    - `coord_space = raster_px`
    - `source_raster_px = 1280×1280`
  - Aerial candidate graph is still strong:
    - `executed (12 candidate edges)`
    - target overlap `0.976`
  - DSM is loaded:
    - `998×998`
  - CPU is healthy:
    - `26.9s / 75s`
    - `48.1s remaining`
  But the backend gate still persists:
  ```

  ```
  ```
  derived_bounds_gate_inputs.frame_mismatch_ok = false
  dsm_registration_callsite_skipped_reason = frame_mismatch_not_ok
  derived_bounds_enabled = false
  ```
  So the next fix is exactly what the plan targets:
  -   
  unify the backend gate with the same overlay/raster truth the UI already trusts  

  -   
  make Roof Focus coordinates crop-relative so the overlay is visually centered and readable  

  I approved the plan and pushed the refined implementation/acceptance details into the repo issue.