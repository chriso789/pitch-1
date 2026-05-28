# PDF Export Verification — Finish the Loop

Scope stays in frontend/PDF/report rendering. No backend, no DSM registration, no topology/pitch/facet logic, no customer_report_ready gate, no geo/selected_perimeter math.

## 1. Run the PDF root / export contract tests

Execute:

- `src/components/measurements/__tests__/MeasurementReportPdfVisualSection.dom.test.tsx`
- `src/lib/measurement/__tests__/alignmentStatus.test.ts`
- `tests/components/MeasurementReportPdfVisualSection.test.tsx`

Extend the DOM test (or add a sibling export-wiring test) so it asserts every contract item, not just structure:

- exactly one `[data-pdf-report-root="true"]` rendered by `MeasurementReportDialog` PDF mount
- exactly one `[data-pdf-overlay-panel="true"]` inside that root
- `downloadVisibleReportPdf` resolves its capture target via `root.querySelector('[data-pdf-report-root="true"]')` and bails loudly if missing (assert via mocked `html2canvas` receiving that exact element)
- PDF root inner text does NOT contain: `Raw JSON`, `Edit vertices`, `Approve`, `Reject`, `Reset`, `AI Process Viewer`, or any layer toggle label (`raster`, `raw_perimeter`, `refined_perimeter`, etc.)
- computed `backgroundColor` on PDF root and on the overlay panel is white (`rgb(255, 255, 255)`)
- no descendant of the PDF root has a dark computed background (scan for `rgb(0,0,0)` / very-low-luminance fills)
- when a perimeter exists in the fixture, the rendered SVG `viewBox` is NOT the full tile — it equals the Roof Focus crop bbox from `roofFocusViewport`

Report pass/fail per assertion.

## 2. Typecheck / build

Run `tsc --noEmit` (already runs in harness) and confirm no errors in:

- `MeasurementReportPdfVisualSection.tsx`
- `MeasurementReportDialog.tsx`
- `RasterOverlayDebugView.tsx`
- `MeasurementVisualQAOverlay.tsx`
- `alignmentStatus.ts`
- `rasterOverlayData.ts`
- `roofFocusViewport.ts`

## 3. Optional compact debug table — PDF-safe, after the visual

Add a `MeasurementReportPdfDebugTable` rendered inside `MeasurementReportPdfVisualSection`, AFTER the `[data-pdf-overlay-panel="true"]` panel and AFTER the compact diagnostics chips. Rules:

- read-only, no buttons, no toggles, no `Raw JSON` block, no `<pre>` dumps
- whitelisted fields only: `result_state`, `geometry_source`, `pitch_source`, `facet_count`, `ridge_lf`, `hip_lf`, `valley_lf`, `eave_lf`, `rake_lf`, `coverage`, `validated_faces_pct`, `footprint_confidence`, `area_ratio`, `topology_score_vs_vendor`, `block_customer_report_reason`, `hard_fail_reason`
- compact 2-column key/value grid, 11px font, `bg-white`/`text-foreground` only, no dark variants
- max ~20 rows; truncate long strings; omit missing fields rather than rendering `null`
- guarded by `pdfMode` so it never appears in the live interactive report
- does NOT reintroduce the large interactive Measurement Data Summary grid, controls, or section headers from the live dialog

If any of those constraints can't be met cleanly, skip the section and note it in the report.

## 4. Regenerate the Fonsica PDF

Trigger the export through the same `downloadVisibleReportPdf` path used in production (no alternate code path). Open the PDF, convert pages to images, and check against acceptance:

- Page 1 starts with header + status (address, result_state, geometry_source, alignment chips)
- Roof-focused aerial overlay appears near the top of page 1
- No large black rectangle under or around the aerial; aerial-unavailable fallback is the white placeholder, not a black box
- Compact debug table (if added in step 3) appears after the visual, not before it
- Raw JSON excluded; interactive controls excluded
- Exactly one aerial overlay panel
- Overlay uses Roof Focus crop (`viewBox` matches `cropBboxPx`)
- `customer_report_ready` remains `false`; `reportable_roof_lines` count remains `0`

## 5. If the black box still appears — stop and return a DOM/capture diff

Do NOT touch derived bounds or topology. Instead emit a diagnostic block containing:

- which DOM root `html2canvas` actually received (selector + outerHTML head)
- count of `[data-pdf-overlay-panel="true"]` elements at capture time
- whether the overlay `<img>` fired `load` vs `error` (or was never mounted)
- `getComputedStyle(...).backgroundColor` for the PDF root and the overlay panel
- the SVG `viewBox` string used at capture
- whether any full interactive `measurement-report-page` / dialog body was inside the captured subtree (boolean + selector path)

## Out of scope (do not touch this loop)

- backend measurement logic, DSM registration, derived bounds runtime, CPU policy
- topology / pitch / facet logic
- `customer_report_ready` gates and reportable roof line promotion
- DB schema, `selected_perimeter_px`, geo coordinates, overlay measurement math  
  
reviewed the latest Lovable verification plan and it’s correct.
  At this point the remaining work is not geometry — it’s proving the new PDF-only export path is actually the one being captured, and proving the UI no longer mislabels the raster overlay as a coordinate mismatch when the real issue is DSM registration missing.
  The important truths from the latest report are:
  - Roof Focus crop math is already correct.
  - Overlay display points are inside the viewport.
  - The aerial overlay is visually usable.
  - DSM registration is still missing.
  - The PDF export still needs hard verification that it is capturing the dedicated `[data-pdf-report-root="true"]` instead of interactive/debug DOM.
  The verification plan correctly focuses on:
  - DOM/export contract assertions
  - white-background enforcement
  - single-overlay enforcement
  - removal of interactive/debug controls
  - alignment/displacement wording cleanup
  - stopping immediately with a DOM/capture diff if the black box still appears
  I approved the plan and pushed the refined implementation/acceptance details into the repo issue.