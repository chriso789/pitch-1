## Goal

Frontend-only cleanup of the Measurement Visual QA / Report dialog so the UI matches actual runtime truth. **No backend, solver, DSM, edge-function, schema, or gate logic changes.** Reportable lines (0), debug lines (6), candidate edges (12), `customer_report_ready=false` all stay exactly as they are today.

## Files to change

1. `src/lib/measurement/registration-gate.ts` — banner classifier
2. `src/components/measurements/MeasurementVisualQAOverlay.tsx` — DSM status card, layer legend, frame_mismatch read
3. `src/components/measurements/RoofOverlayViewer.tsx` — add Roof Focus / Full Tile viewport toggle
4. `src/components/measurements/MeasurementReportDialog.tsx` — top diagnostic wording, CPU-late display, pass `frame_mismatch` + perimeter bbox into the viewer

## Changes

### 1. Banner copy: stop blaming the coordinate frame when raster overlay is fine

In `registration-gate.ts → registrationBanner()`, also read the actual overlay transform's `frame_mismatch` flag (from `geometry_report_json.overlay_debug.frame_mismatch` / `overlay_transform.frame_mismatch`).

Logic:

- `frameOk = frame_mismatch === "ok"` (explicit string check).
- If `frameOk && dsmFailed` (any of `geo_to_dsm_px_success`, `dsm_pixel_transform_valid`, `confirmed_center_inside_candidate` false) → **warning** banner:
  - Title: `DSM registration incomplete — manual approval locked`
  - Body: `The aerial perimeter is aligned to the satellite image, but DSM georegistration is missing. Manual approval is locked because the system cannot safely validate pitch/topology until geo→DSM and DSM→raster transforms are available.`
  - Keep the `failedFlags` list (`geo_to_dsm_px_success`, `dsm_pixel_transform_valid`, `confirmed_center_inside_candidate`) rendered below.
  - Do NOT suggest re-placing the PIN.
- Only keep the existing `Coordinate frame mismatch — overlay not eligible for manual approval` copy when `frame_mismatch !== "ok"` AND `confirmed_center_inside_candidate === false`.
- `targetFailed` (PIN unconfirmed) branch unchanged.

`canApproveManualPerimeter()` unchanged — DSM failure still locks approval.

### 2. DSM Status card inside Visual QA

In `MeasurementVisualQAOverlay.tsx`, add a small card (alongside the existing diagnostic grid) reading from `geometry_report_json`:

```
DSM Status:     Loaded, not registered   (or: Registered / Missing)
DSM Size:       {dsm_size.w}×{dsm_size.h}
DSM Bounds:     {dsm_bounds_failure || "ok"}
DSM Transform:  {dsm_to_raster_transform_source || "unavailable"}
DSM Overlay:    {dsm_overlay_visible ? "shown" : "suppressed"}
Policy:         {dsm_transform_policy || "dsm-registration-transform-v1"}
```

Derivation rules (read-only, no fallbacks invented): loaded if `dsm_size` present; registered if `dsm_pixel_transform_valid === true`.

### 3. Layer legend clarity

In the overlay legend, replace the flat color legend with three explicit rows showing presence:

- Aerial perimeter candidate — `visible` when `aerial_candidate_roof_graph` or `selected_perimeter_px` present.
- DSM-derived topology — `unavailable` when DSM registration failed; otherwise `visible`.
- Reportable roof lines — `none` when reportable count == 0; otherwise `N lines`.

### 4. Roof Focus zoom toggle in `RoofOverlayViewer.tsx`

Add an optional `focusBboxPx?: { minX,minY,maxX,maxY }` prop and a `defaultMode?: "roof_focus" | "full_tile"` prop. Internal state toggles between the two; two small buttons render top-right: **Full Tile** / **Roof Focus**.

Implementation:

- When `focusBboxPx` is provided, default to `roof_focus`.
- In `roof_focus` mode, change the SVG `viewBox` to `minX-pad minY-pad (w+2pad) (h+2pad)` (pad ≈ 100px, clamped to image bounds). The `<img>` is wrapped in the same scaled container using CSS `object-fit:none` + `transform: scale()/translate()` so the underlying pixels align with the SVG viewBox. Existing line/polygon/label coords already live in image-pixel space, so the overlay continues to map correctly — no transform math changes.
- In `full_tile` mode, current behavior (viewBox = `0 0 image.width image.height`, `object-cover`).

`MeasurementReportDialog.tsx` (and any other call sites) computes `focusBboxPx` from `selected_perimeter_px` or `aerial_candidate_roof_graph.perimeter_ring_px` and passes it in. If neither exists, prop is omitted and viewer falls back to Full Tile.

### 5. Top diagnostic wording

In `MeasurementReportDialog.tsx` line ~992, replace:

> "AI Measurement stopped during perimeter topology validation because the runtime budget was exceeded. No customer report was generated."

with:

> "AI Measurement found an aerial roof perimeter, but customer-ready topology was blocked. DSM georegistration is missing and the run exceeded the CPU reserve before validated topology could complete."

### 6. CPU status display

Where CPU budget is rendered, when `late_cpu_preempt === true` OR `cpu_budget_remaining_ms < 0`, show:

```
CPU reserve missed
Elapsed:        88.8s / 75s
Remaining:      -13.8s
Preempt reason: wall_clock_reserve_threshold
```

(values pulled from `cpu_budget_elapsed_ms`, target budget, `cpu_budget_remaining_ms`, `cpu_preempt_reason`). Existing "normal preemption" copy used only when neither condition is true.

### 7. Bonus runtime fix (quiet)

Fix the `Failed to fetch dynamically imported module: LeadDetails.tsx` runtime error if a stale chunk reference is the cause (verify by reading the file; only adjust imports if there's a real broken reference — otherwise leave alone).

## Out of scope (explicitly untouched)

`customer_report_ready`, reportable line count, debug line count, aerial candidate graph resolver, all edge functions, DSM solver, derived DSM fallback, DB schema, approval gating logic.

## Acceptance

- Banner reads "DSM registration incomplete — manual approval locked" on this Fonsica run (frame_mismatch=ok, DSM invalid).
- Old coordinate-mismatch copy only renders when frame_mismatch ≠ ok.
- DSM Status card visible with the six lines above.
- Layer legend shows the three explicit rows with current statuses (visible / unavailable / none).
- Overlay viewer defaults to Roof Focus when perimeter bbox exists; Full Tile / Roof Focus toggle works; overlay lines remain pixel-correct.
- Top diagnostic uses the new wording.
- CPU panel shows "CPU reserve missed" with elapsed 88.8s / 75s, remaining -13.8s.
- Reportable=0, Debug=6, Candidates=12, customer_report_ready=false all unchanged.  
  

  ```
  Go.

  Implement the frontend-only Measurement Visual QA / Report dialog cleanup exactly as scoped.

  This is UI-only.

  Do not touch:
  - customer_report_ready
  - reportable line count
  - debug line count
  - aerial candidate graph resolver
  - edge functions
  - DSM solver
  - derived DSM fallback
  - DB schema
  - approval gating logic
  - backend measurement logic

  Critical guardrail:
  Roof Focus must not alter measurement coordinates or overlay source data. It may only change the viewport/viewBox/crop display around existing image-pixel coordinates.

  Approved files:
  - src/lib/measurement/registration-gate.ts
  - src/components/measurements/MeasurementVisualQAOverlay.tsx
  - src/components/measurements/RoofOverlayViewer.tsx
  - src/components/measurements/MeasurementReportDialog.tsx

  Required acceptance:
  - Fonsica banner reads:
    DSM registration incomplete — manual approval locked
    when frame_mismatch=ok and DSM invalid.

  - Coordinate frame mismatch copy only appears when frame_mismatch !== ok.

  - DSM Status card shows:
    DSM Status: Loaded, not registered
    DSM Size: 998×998
    DSM Bounds: dsm_tile_bounds_missing_from_google_solar_metadata
    DSM Transform: unavailable
    DSM Overlay: suppressed
    Policy: dsm-registration-transform-v1

  - Layer legend shows:
    Aerial perimeter candidate — visible
    DSM-derived topology — unavailable
    Reportable roof lines — none

  - Overlay viewer defaults to Roof Focus when selected_perimeter_px or aerial_candidate_roof_graph.perimeter_ring_px exists.

  - Full Tile / Roof Focus toggle works.

  - Overlay lines remain pixel-correct in both modes.

  - Top diagnostic says:
    AI Measurement found an aerial roof perimeter, but customer-ready topology was blocked. DSM georegistration is missing and the run exceeded the CPU reserve before validated topology could complete.

  - CPU panel shows:
    CPU reserve missed
    Elapsed: 88.8s / 75s
    Remaining: -13.8s
    Preempt reason: wall_clock_reserve_threshold

  - Reportable Roof Lines remains 0.
  - Debug Roof Lines remains 6.
  - Aerial Candidate Graph remains executed (12 candidate edges).
  - customer_report_ready remains false.
  ```
  After this UI cleanup, the next backend prompt should still be **Controlled Derived DSM Bounds Fallback v1**.