## Context

Most of this spec was implemented in the previous turn:

- `supabase/functions/_shared/resolveFrameMismatch.ts` — exists with 9 explicit paths + legacy `dsmCoordinateMatchDebug` arg + inference fallback + `raster_registration_evidence`.
- `start-ai-measurement/index.ts` — builds `_geometryViewForFrame`, calls `resolveFrameMismatch(...)`, passes resolved `frame_mismatch` into `runEarlyDerivedDsmRegistration`, attaches `gate_inputs` (frame_mismatch_ok/source/raw/evidence + overlap + selected_perimeter_present + dsm/raster flags) so `mergeEarlyDsmRegistrationIntoDebug` surfaces them as `derived_bounds_gate_inputs`.
- `supabase/functions/_shared/__tests__/resolveFrameMismatch.test.ts` — covers priority wins, explicit mismatch, Fonsica inference fallback.
- `src/lib/measurement/resolveFrameMismatch.ts` — frontend mirror.
- `src/lib/measurement/registration-gate.ts` — uses resolver; emits DSM-incomplete copy (not coord-mismatch) when frame is OK.
- `src/components/measurements/MeasurementVisualQAOverlay.tsx` — DSM Status card fans out across the 6 canonical `dsm_size_px` paths and reads `dsm_bounds_failure`, `dsm_to_raster_transform_source`, `dsm_pixel_transform_valid`.

What's still missing vs. the spec, and the only work this plan covers:

## Gaps to close

### 1. Backend integration regression test

Create `supabase/functions/start-ai-measurement/__tests__/early-dsm-registration-frame-mismatch-source.test.ts`:

- **Explicit Fonsica positive** — geometry view with no top-level `frame_mismatch` but `overlay_transform.frame_mismatch="ok"`, full raster+DSM evidence. Assert `runEarlyDerivedDsmRegistration` is invoked with `frame_mismatch:"ok"`, result is not skipped with `frame_mismatch_not_ok`, and `gate_inputs.frame_mismatch_source==="overlay_transform.frame_mismatch"`.
- **Inferred Fonsica positive** — no explicit string anywhere; raster_px coord space, overlap 0.976, bounds contain center, selected perimeter present. Assert `gate_inputs.frame_mismatch_source==="inferred_from_raster_registration_evidence"` and registration runs.
- **Negative** — explicit `frame_mismatch:"raster_outside_dsm"` with weak fallback evidence. Assert early registration skips with `frame_mismatch_not_ok` and `gate_inputs.frame_mismatch_ok===false`.

The test imports `runEarlyDerivedDsmRegistration` and `resolveFrameMismatch` directly and exercises the wiring as a unit (no full edge-function bootstrap) to keep it fast and deterministic.

### 2. Frontend resolver: add `raster_registration_evidence`

`src/lib/measurement/resolveFrameMismatch.ts` currently omits `raster_registration_evidence` from its return shape. Add it (mirror of backend) so any future consumer (banner tooltips, debug panel) can introspect the same fields. No call-site changes required.

### 3. Frontend tests

Add `src/lib/measurement/__tests__/registrationBanner.frame-ok.test.ts`:

- When `geometry_report_json.overlay_transform.frame_mismatch==="ok"` and DSM flags are false, `registrationBanner(...)` returns variant `"warning"` with title `"DSM registration incomplete — manual approval locked"` (never coordinate-mismatch copy).
- When `overlay_transform.frame_mismatch==="raster_outside_dsm"` and `confirmed_center_inside_candidate===false`, banner returns destructive coordinate-mismatch copy.

Add `src/components/measurements/__tests__/MeasurementVisualQAOverlay.dsm-status.test.tsx`:

- DSM Status card resolves size `998×998` when only `registration.dsm.dsm_size_px` is set; same for each of the other 5 canonical paths.
- Renders `Status: Loaded, not registered` when `dsm_loaded===true` and `dsm_pixel_transform_valid===false`.

### 4. (Optional, low risk) Verify 10th legacy priority source

Confirm `resolveFrameMismatch` checks `dsmCoordinateMatchDebug.frame_mismatch || .match_status || .is_valid` after all 9 geometry paths. If absent, add it and cover with a unit test case.

## Out of scope (explicitly not touched)

DSM transform math, `_shared/dsm-registration.ts` algorithms, `customer_report_ready` gating, reportable roof line promotion, topology / pitch / facet promotion, DB schema, CPU containment policy, aerial graph builder.

## Acceptance

- New backend test passes; failing it would have caught the original `frame_mismatch_not_ok` bug.
- New frontend tests lock the banner copy and DSM Status card resolution.
- Next Fonsica run shows `derived_bounds_gate_inputs.frame_mismatch_ok=true` with `frame_mismatch_source` set to either `overlay_transform.frame_mismatch` or `inferred_from_raster_registration_evidence`, no `frame_mismatch_not_ok` skip, `dsm_bounds_derived=true`, and Visual QA shows the DSM-incomplete banner with `998×998` size.  
  
Approve this plan. It is the right follow-up because it **does not reopen DSM math**. It only locks down the fix with tests and completes the frontend parity.
  One correction: this should be treated as **test hardening + UI parity**, not a new backend feature. The actual runtime fix was already mostly implemented.
  Send this:
  ```

  ```
  ```
  Go.

  Implement the remaining frame-mismatch source resolver hardening exactly as scoped.

  This is test hardening + UI parity only.

  Do not touch:
  - DSM transform math
  - _shared/dsm-registration.ts algorithms
  - customer_report_ready gates
  - reportable roof line promotion
  - topology / pitch / facet promotion
  - DB schema
  - CPU containment policy
  - aerial graph builder

  Context:
  Most of the runtime fix already exists:
  - backend resolveFrameMismatch helper exists
  - start-ai-measurement already calls it before early derived DSM registration
  - derived_bounds_gate_inputs are already persisted
  - frontend resolveFrameMismatch helper exists
  - registration banner uses the resolver
  - DSM Status card now fans out across the canonical DSM paths

  Remaining work:

  1. Backend integration regression test

  Add:
  supabase/functions/start-ai-measurement/__tests__/early-dsm-registration-frame-mismatch-source.test.ts

  Test A — Explicit Fonsica positive:
  - geometry view has no top-level frame_mismatch
  - overlay_transform.frame_mismatch = "ok"
  - full raster + DSM evidence
  - target_mask_overlap_with_perimeter = 0.976
  - DSM loaded = true
  - DSM size = 998×998
  - raster bounds present
  - geo_to_raster_transform present

  Assert:
  - runEarlyDerivedDsmRegistration receives frame_mismatch: "ok"
  - result is not skipped with frame_mismatch_not_ok
  - gate_inputs.frame_mismatch_ok = true
  - gate_inputs.frame_mismatch_source = "overlay_transform.frame_mismatch"
  - early derived registration succeeds or at minimum reaches the success branch fixture path
  - dsm_bounds_derived = true
  - dsm_pixel_transform_valid = true

  Test B — Inferred Fonsica positive:
  - no explicit frame_mismatch anywhere
  - coordinate_space_candidate = raster_px
  - coordinate_space_renderer = raster_px
  - raster size exists
  - confirmed_center_px exists
  - raster_bounds_contain_confirmed_center = true
  - selected_candidate_polygon_px_present = true
  - target_mask_overlap_with_perimeter = 0.976

  Assert:
  - gate_inputs.frame_mismatch_ok = true
  - gate_inputs.frame_mismatch_source = "inferred_from_raster_registration_evidence"
  - early registration runs

  Test C — Negative:
  - explicit frame_mismatch = "raster_outside_dsm"
  - weak fallback evidence

  Assert:
  - early registration skips with frame_mismatch_not_ok
  - gate_inputs.frame_mismatch_ok = false
  - geo_to_dsm_px_success = false
  - dsm_pixel_transform_valid = false

  2. Frontend resolver parity

  Update:
  src/lib/measurement/resolveFrameMismatch.ts

  Add raster_registration_evidence to the return shape, mirroring backend.

  No call-site behavior changes required.

  3. Frontend banner tests

  Add:
  src/lib/measurement/__tests__/registrationBanner.frame-ok.test.ts

  Cases:
  - overlay_transform.frame_mismatch = "ok" and DSM flags false:
    registrationBanner returns warning with title:
    "DSM registration incomplete — manual approval locked"
    and does NOT return coordinate-mismatch copy.

  - overlay_transform.frame_mismatch = "raster_outside_dsm" and confirmed_center_inside_candidate = false:
    registrationBanner returns destructive coordinate-mismatch copy.

  4. DSM Status card tests

  Add:
  src/components/measurements/__tests__/MeasurementVisualQAOverlay.dsm-status.test.tsx

  Cases:
  - DSM Status card resolves size 998×998 from each canonical path:
    - registration.dsm.dsm_size_px
    - registration.dsm_size_px
    - registration.transform_package.dsm_size_px
    - dsm_split_status.dsm_size_px
    - registration_gate.dsm_size_px
    - legacy dsm_size / dsm.size

  - Renders:
    Status: Loaded, not registered
    when dsm_loaded = true and dsm_pixel_transform_valid = false.

  5. Verify legacy source

  Confirm backend resolveFrameMismatch checks legacy:
  - dsmCoordinateMatchDebug.frame_mismatch
  - dsmCoordinateMatchDebug.match_status
  - dsmCoordinateMatchDebug.is_valid

  after all geometry paths.

  If missing, add it and cover with a unit test.

  Acceptance:
  - New backend integration test would have caught the original frame_mismatch_not_ok bug.
  - Frontend banner test locks DSM-incomplete copy when frame is OK.
  - DSM Status card test locks 998×998 path fan-out.
  - No production behavior changes except frontend resolver return shape adding raster_registration_evidence.
  - Next Fonsica run should show:
    derived_bounds_gate_inputs.frame_mismatch_ok = true
    frame_mismatch_source = overlay_transform.frame_mismatch OR inferred_from_raster_registration_evidence
    no frame_mismatch_not_ok skip
    derived_bounds_enabled = true
    dsm_bounds_derived = true
  ```
  After this passes, rerun Fonsica. If the live row still skips, the next diff should show exactly which gate input is false.
- &nbsp;