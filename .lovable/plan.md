## Goal

PDF-only export currently captures the correct DOM root, but:

1. The Google Static Map `<image>` inside the SVG fails to load under html2canvas, producing a large white "aerial unavailable in export" block.
2. PDF diagnostic chips read the wrong paths — they show `DSM Size 640×640` (static-map request size) and `Debug Roof Lines 0`, while the live UI correctly shows `998×998` and `6`.
3. Visual QA "Measurement Alignment" still labels aerial overlay as `unknown` despite valid crop evidence.

Frontend/PDF rendering only. No backend, DSM, topology, gates, schema, or coordinate-math changes.

## Changes

### 1. Export-safe aerial image loader — `src/lib/measurements/exportImageLoader.ts` (new)

- `fetchAsDataUrl(url, { timeoutMs = 5000 })` — fetches the raster URL (Google Static Map, Mapbox, persisted RGB), decodes to a `data:` URL via `FileReader`. Returns `{ state: 'loaded' | 'error' | 'timeout', dataUrl?, error? }`.
- `waitForImagesInRoot(root, { timeoutMs = 5000 })` — finds every `<img>` and SVG `<image>` inside the PDF root, awaits `decode()`/`load`/`error`, returns a per-image status array `[{ selector, src_type, state, error }]`.

Pure helper, no backend calls.

### 2. PDF overlay uses pre-resolved data URL — `MeasurementReportPdfVisualSection.tsx` + `RasterOverlayDebugView.tsx`

- Add an internal `useEffect` in `MeasurementReportPdfVisualSection` that, when `rasterUrl` is set and `pdfMode` is true, calls `fetchAsDataUrl(rasterUrl)` and stores the result in state.
- Pass `imageUrl={dataUrl ?? rasterUrl}` to `RasterOverlayDebugView`. If both fetch and direct load fail, render a clear placeholder:
  - White background, light-gray border, prominent label **"Aerial image unavailable in PDF export"**
  - Sub-label: *"Overlay lines are still shown for diagnostic review."*
  - SVG overlay (perimeter polygon / edges) still rendered above the placeholder when `focusPerimeterPx`/`edges_px` exist.
  - Reasonable bounded height (e.g. `aspect-ratio: 4/3`) — no giant empty rectangle.
- Always emit exactly one `[data-pdf-overlay-panel="true"]`.

### 3. Export wait wired into download path — `MeasurementReportDialog.tsx::downloadVisibleReportPdf`

- Before `capturePageImage(pdfRoot, ...)`, call `waitForImagesInRoot(pdfRoot, { timeoutMs: 5000 })` and `console.log('PDF export image states:', states)`.
- Existing `<img>`-awaiter in `capturePageImage` retained but extended to SVG `<image>` too.

### 4. PDF chip resolvers — extract to `src/lib/measurements/pdfChipFields.ts` (new, pure)

Single source of truth for the chips, reused by tests:

- `resolveDsmSize(grj)` — priority:
  1. `registration.dsm.dsm_size_px`
  2. `registration.dsm_size_px`
  3. `registration.transform_package.dsm_size_px`
  4. `dsm_split_status.dsm_size_px`
  5. `registration_gate.dsm_size_px`
  6. `registration_gate.transform_package.dsm_size_px`
  7. legacy `dsm_size_px`, `dsm_size`, `dsm.size`
  Never reads `registration.size` (static-map request size).
- `resolveDebugRoofLinesCount(grj)` — priority:
  1. `debug_roof_lines_count` (number)
  2. `debug_roof_lines.length`
  3. `dsm_planar_graph_debug.debug_roof_lines.length`
  4. `terminal_debug_payload.debug_roof_lines_count`
  5. `terminal_debug_payload.raw_debug.debug_roof_lines_count`
  Does NOT fall back to `aerial_candidate_roof_graph.edges.length`.
- `resolveAerialCandidateEdgeCount(grj)` — delegates to existing `resolveAerialCandidateGraph()` so PDF and Visual QA stay in sync.
- `resolveDsmStatusLabel(grj)` — delegates to existing `resolveDsmStatusFields()` (already canonical).

`MeasurementReportPdfVisualSection` replaces its inline `dsmSize`/`debugRoofLines`/`aerialEdgeCount`/`dsmStatus` logic with these helpers.

### 5. Visual QA "Aerial overlay unknown" resolver — `src/lib/measurement/alignmentStatus.ts`

Add aerial-overlay branch: when `overlay_transform.coord_space === 'raster_px'` and `crop_bbox_px` is valid, return `'aligned'` instead of `'unknown'`. Pure helper, covered by existing test file.

### 6. Tests

- `src/lib/measurements/__tests__/pdfChipFields.test.ts` (new)
  - DSM Size: `registration.dsm.dsm_size_px = {998,998}` → `998×998`; `registration.size = {640,640}` alone → not used.
  - Debug Roof Lines: `debug_roof_lines_count = 6` → 6; falls back through nested paths; does NOT pick up `aerial_candidate_roof_graph.edges.length`.
  - Aerial Candidate Graph: `aerial_candidate_roof_graph.edges.length = 12` → 12.
- `src/lib/measurements/__tests__/exportImageLoader.test.ts` (new)
  - `waitForImagesInRoot` resolves `loaded`/`error`/`timeout` per image; resolves before `timeoutMs` cap; html2canvas-callable contract documented.
- Extend `MeasurementReportPdfVisualSection.dom.test.tsx`
  - Failed-image case: placeholder text is `"Aerial image unavailable in PDF export"`, panel is white, perimeter SVG polygon still rendered when `selected_perimeter_px` provided.
- Extend `alignmentStatus.test.ts`
  - `overlay_transform.coord_space==='raster_px' + valid crop_bbox_px` → aerial overlay `aligned`.

## Acceptance

- PDF chip shows `DSM Size 998×998` (not 640×640) and `Debug Roof Lines 6` for current Fonsica payload — proven by unit tests.
- `downloadVisibleReportPdf` waits for SVG `<image>` decode and logs per-image state before html2canvas.
- When aerial loads, satellite image renders in the PDF overlay. When it fails, the panel stays white with a clear label and overlay lines still on top — never a black/dark block.
- `[data-pdf-overlay-panel="true"]` count remains 1; Raw JSON, edit/approve/reject, layer toggles, AI Process Viewer stay excluded.
- Visual QA aerial overlay row reports `aligned` when crop evidence is valid.
- No backend, DSM, topology, gate, or schema changes. `customer_report_ready` and reportable roof line promotion untouched.

## Out of scope

- Actual rerun of Fonsica PDF in browser (requires live session — user verifies after build).
- Backend DSM registration / derived bounds / topology / pitch / facet logic.
- `customer_report_ready` promotion logic.  
  
I reviewed the latest report and the Lovable plan is correct.
  The important thing is the problem changed again:
  Before:
  - wrong DOM/export root
  - dark container/background
  Now:
  - the PDF-only export root is actually working
  - the aerial overlay panel is rendering
  - but the Google Static Map image inside the export is failing to load under html2canvas/export
  - so the white fallback placeholder now fills the overlay area
  That’s why the “black box” got bigger visually — the export now dedicates a large roof-focused visual area near the top, but the actual raster image is unavailable, so you’re seeing the fallback panel instead of the satellite image.
  The latest report also proves two frontend data-path bugs:
  - PDF chip incorrectly shows DSM Size `640×640` instead of `998×998`
  - PDF chip incorrectly shows Debug Roof Lines `0` instead of `6`
  The live interactive report below clearly shows the correct values, meaning the PDF-only component is reading the wrong paths.
  The approved next step is exactly right:
  - export-safe raster image loading/data-URL conversion
  - wait-for-image/decode before html2canvas
  - proper PDF-only chip resolvers
  - alignment-status wording cleanup (`aligned` instead of `unknown`)
  I pushed the refined implementation/acceptance details into the repo issue.
- &nbsp;