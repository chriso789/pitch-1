## Scope

Display/PDF-only fix. No backend, no DSM/topology/gate changes, no DB schema. Underlying coordinates (`selected_perimeter_px`, geo, DSM transforms, measurements) are untouched.

## Why the PDF still has a black block

1. `RasterOverlayDebugView` (the "Roof Overlay" panel at `MeasurementReportDialog.tsx:2170`) renders an SVG with `viewBox="0 0 W H"` — full raster (typically 1024×1024 or 1280×1280) — wrapped in `<div className="relative w-full bg-muted rounded overflow-hidden">`. When the actual roof bbox is small (e.g. `500,471→790,782` ≈ 290×311 of a 1280-px tile), the rendered SVG is a near-square tile where the aerial `<image href={imageUrl}>` is the Google Static Maps URL. In `capturePageImage` (`html2canvas`, `useCORS:true, allowTaint:false`), CORS commonly fails for the static map and the `<image>` paints empty / dark, leaving a large empty rectangle around a tiny roof. That is the "black area".
2. The first aerial diagram (Roof Overlay) is full-tile; the second (`MeasurementVisualQAOverlay`, lines 247–304) already has Roof Focus math and auto-switches to it once a perimeter is available. So the two diagrams disagree on zoom.
3. Roof Focus math currently lives only inside `MeasurementVisualQAOverlay` — there is no shared helper, so `RasterOverlayDebugView` and any PDF block can't reuse it.

## Plan

### 1. Extract a single Roof Focus helper

New file: `src/lib/measurements/roofFocusViewport.ts`.

Pure functions, no React:

```ts
export interface RoofFocusInput {
  rasterSize: { width: number; height: number };
  perimeterPx: Array<[number, number]>;        // selected, refined, or raw — caller decides priority
  padFraction?: number;                         // default 0.15
  minPadPx?: number;                            // default 80
  maxPadPx?: number;                            // default 120
  displayWidth: number;                         // px the panel renders at
}
export interface RoofFocusViewport {
  cropBboxPx: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number };
  cropScale: number;                            // displayWidth / cropBboxPx.w
  cropOffset: { x: number; y: number };         // = (-minX*scale, -minY*scale)
  displayPxWithinCrop: { width: number; height: number };
  /** source raster px → display px inside the crop */
  project: (pt: [number, number]) => [number, number];
  /** Convenience: SVG viewBox string for the crop. */
  viewBox: string;                              // "minX minY w h"
  isFocused: boolean;                           // false when perimeter empty → returns full-tile viewport
}
```

`MeasurementVisualQAOverlay` is refactored to consume this helper instead of its inline `viewportSrc` math (lines 247–308). Same numbers, just centralised. The diagnostics card that prints `crop_bbox_px` / `display_px_within_crop` / `first_pt_disp` / `bbox_center_disp` continues to render — values now sourced from the helper so they match the projected geometry exactly.

### 2. Make `RasterOverlayDebugView` roof-focused

`src/components/measurements/RasterOverlayDebugView.tsx`

- Accept new optional prop `focusPerimeterPx?: Array<[number, number]>` (caller passes selected perimeter, or refined / raw fallback).
- When `focusPerimeterPx.length >= 3`, compute `roofFocusViewport(...)` and set the SVG `viewBox` to `roofFocusViewport.viewBox` (i.e. the crop bbox in source raster pixels, NOT `0 0 W H`).
- Keep the underlying point data unchanged — the SVG continues to draw in raster source pixels; only the viewBox changes, so all existing polygon/edge points still line up.
- Drop `preserveAspectRatio="xMidYMid meet"` letterboxing risk by giving the wrapper a dynamic height: replace `<div className="relative w-full bg-muted ...">` with a wrapper whose `paddingBottom` = `(crop.h / crop.w) * 100%` (aspect-ratio box). Background becomes `bg-white` (not `bg-muted`, never black) to satisfy the "no black fill" requirement.
- Provide a fallback inline note "aerial unavailable" when the `<image>` `onError` fires, so a CORS failure shows a labeled white panel rather than empty space.

`MeasurementReportDialog.tsx` (both call sites, lines 2091 and 2170) passes `focusPerimeterPx` derived from the same priority used in Visual QA (selected → refined → raw → footprint).

### 3. PDF capture: ensure no dark/black backgrounds slip in

`MeasurementReportDialog.tsx`, `createExportReadyClone` / `capturePageImage`:

- `wrapper.style.background` is currently `hsl(var(--background))` (theme-dependent — dark in dark mode). Force `#ffffff` for the export wrapper to match the existing `backgroundColor: "#ffffff"` in `captureOptions`.
- In the clone, walk descendants and rewrite any element with computed `background-color` darker than `#404040` that is NOT explicitly a chart/canvas/img to `#ffffff`. (Conservative — only affects the off-screen clone used for capture.)
- For overlay panels specifically, mark the new aspect-ratio wrapper with `data-pdf-overlay-panel="true"` and in the export clone force its background to `#ffffff` and remove any `bg-muted` class.
- When the aerial `<image>` fails to load (detected via `onError`), substitute a same-aspect `<rect fill="#ffffff" stroke="#cbd5e1" stroke-dasharray="4 4"/>` and a centered `<text>` "aerial unavailable in export" inside the SVG so the PDF never shows raw black.

### 4. Reorder the PDF page so the visual leads

`MeasurementReportDialog.tsx` report layout (around the `measurement-report-page` blocks ~2080–2200): introduce explicit visual-first ordering for the diagnostic page:

1. Header / status badges (existing).
2. **Roof-focused aerial overlay** (the updated `RasterOverlayDebugView` with focus, OR `MeasurementVisualQAOverlay`'s overlay canvas snapshot). One of them, top of page — not both stacked.
3. Compact key diagnostics card (existing summary chips).
4. Detailed debug table.
5. Raw JSON dumps stay tagged `data-pdf-exclude="true"` (already removed in `createExportReadyClone`) — keep them out of the PDF.

Implementation: wrap the two overlays in a small `MeasurementReportVisualSection` component that picks the "best" overlay (Visual QA if `rasterSizeResolved && focusPerimeterPx≥3`, else `RasterOverlayDebugView` with focus, else a "no overlay available" placeholder). The placeholder is white/transparent, never black.

### 5. Overlay legend cleanup for current state

`MeasurementVisualQAOverlay` legend (and the new visual section): when `dsm` layer is unavailable (`dsmAllowed === false` or `dsmEdges.length === 0`) AND there are no reportable roof_lines, render the legend exactly as:

- Aerial perimeter candidate — visible
- Selected perimeter — visible / editable
- DSM topology — unavailable (greyed, with "not persisted" tooltip)
- Reportable roof lines — none

No phantom "visible" rows for layers that have no data.

### 6. Tests

New file `tests/unit/lib/measurements/roofFocusViewport.test.ts`:

- Input: raster 1280×1280, perimeter sampled so bbox = `500,471 → 790,782`, displayWidth = 715.
- Assert `cropBboxPx.w === 290` (pre-pad) → padded by ~44 (15% × 290) clamped to `[80,120]`, so pad = 80 → `cropBboxPx` ≈ `{ minX:420, minY:391, maxX:870, maxY:862, w:450, h:471 }` (exact values asserted from the helper, not hand-fudged).
- Assert `displayPxWithinCrop.width === 715` and height = `715 × h/w`.
- Project first source point `[596.6, 550.9]` → assert result is inside `[0, displayWidth] × [0, displayHeight]`.
- Project bbox center `[(500+790)/2, (471+782)/2]` → assert inside viewport and within `±1px` of the analytical center.
- Assert when `perimeterPx.length < 3`, `isFocused === false` and `viewBox === "0 0 1280 1280"`.

New file `tests/unit/components/measurements/RasterOverlayDebugView.dom.test.tsx`:

- Render with a small perimeter; assert the rendered `<svg>` has `viewBox` matching the crop bbox (not `"0 0 1024 1024"`).
- Assert the outer wrapper has `data-pdf-overlay-panel="true"` and `background-color: rgb(255, 255, 255)` (no `bg-muted`, no black).
- Assert no descendant of the panel has computed `background-color` darker than `#202020`.

Optional: `tests/unit/components/measurements/MeasurementReportDialog.export.test.tsx` snapshot of the cloned export tree confirming `wrapper.style.background === '#ffffff'` and that overlay panels have white background after the export-clone pass.

Tests are run via `bunx vitest run <path>`.

## Files touched

- `src/lib/measurements/roofFocusViewport.ts` (new)
- `src/components/measurements/MeasurementVisualQAOverlay.tsx` — refactor `viewportSrc` to use the helper; diagnostics card now reads from helper outputs.
- `src/components/measurements/RasterOverlayDebugView.tsx` — accept `focusPerimeterPx`; viewBox = focus crop; aspect-ratio wrapper; white background; `<image onError>` fallback.
- `src/components/measurements/MeasurementReportDialog.tsx` — both `RasterOverlayDebugView` call sites pass `focusPerimeterPx`; export wrapper background forced `#ffffff`; visual-first ordering via small `MeasurementReportVisualSection` helper inline or as a sibling file.
- New tests under `tests/unit/...` as above.

## Out of scope (per user)

Backend measurement logic, DSM registration, derived bounds runtime, CPU policy, topology/pitch/facet logic, `customer_report_ready` gates, reportable roof-line promotion, DB schema.

## Separate follow-up (not in this PR)

`derived_bounds_debug` is currently not surfaced in the visible PDF debug table. To verify after this PR ships: re-run Fonsica, open the PDF, confirm the debug table includes a `derived_bounds_debug` row. If still missing, that's a separate "expose `derived_bounds_debug` in the debug table" ticket — not bundled here because it would expand scope beyond display fixes.  
  
I reviewed the latest PDF/report and the Lovable plan is correct.

You were right about both issues:

1. The large black area is not a measurement failure — it is a PDF/export rendering problem caused by the overlay panel still using a full-raster SVG/container with a dark background when the Google static map image fails or the crop does not fill the fixed container.
2. The second aerial image is now the correct one because the Roof Focus crop math is finally working. The first aerial/overlay panel is still using a different/full-tile viewport, so the report visually disagrees with itself.

The good news is the crop math is now objectively correct:

```

```

```
crop_bbox_px: 500,471→790,782
display_px_within_crop: 715×768
first_pt_disp: 238.3,197.6
bbox_center_disp: 357.5,384.1
```

Those projected display points are finally inside the visible viewport, which means the overlay alignment math itself is now solid. 

The next fix is exactly what the plan targets:

-   
unify all aerial visuals under the same Roof Focus helper  

-   
make PDF export use the same crop-aware viewport  

-   
eliminate dark/black export containers  

-   
move the useful roof-focused visual to the top of the report  


I approved the plan and pushed the refined implementation/acceptance details into the repo issue.