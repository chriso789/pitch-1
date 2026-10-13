# PITCH PDF — PdfCraft integration status

Source: https://github.com/storytold/pdfcraft, pinned at `0a0986483378b57d62103a36490bd66166d32c8f`.
License: MIT OR Apache-2.0 (copies of LICENSE-MIT, LICENSE-APACHE, NOTICE in `engines/pdfcraft-measure-wasm/`). ArtCraft brand assets are not used.
`PDFCraftTool/pdfcraft` (AGPL-3.0): no code used. Concepts only, implemented independently.

## Phase 1 — Plan Measurement (built)

### Engine actually running
- **PdfCraft `pdfcraft-measure` compiled to WebAssembly** (`public/wasm/pitch_pdfcraft_measure_bg.wasm`, ~620 KB, unoptimised).
  Bindings: `engines/pdfcraft-measure-wasm/src/lib.rs` (calibrate, reading, view_to_user/user_to_view, page_geometry, snap, list, add_measurement).
  Rebuild: `engines/pdfcraft-measure-wasm/build.sh` (needs Rust >= 1.95 — upstream `rust-version`; nixpkgs 1.91 is too old, rustup stable 1.99 works — plus wasm32 target and wasm-pack). `wasm-opt` hung in the sandbox, so the build uses `--no-opt`.
- **Fallback:** `src/lib/plan-measure/jsEngine.ts`, a re-implementation of the same math. It runs only if the WASM fails to load, and the UI then shows "PITCH JS fallback". It can't read PDF content, so with it snapping and measured-copy saving are off.
- Adapter: `src/lib/plan-measure/types.ts` (`MeasureEngine`). The UI talks only to the adapter.

### Workflow
Commercial project → Drawings & Files → **Measure** (`/commercial/:id/plans/:documentId/measure`).
1. Thumbnails, zoom, view rotation and vector rendering (PDF.js canvas).
2. Scale per sheet, or per drawn viewport: either calibrated from a known dimension, or the drawing's stated ratio (UserUnit-aware). Every scale starts **Not verified**.
3. Verify against a second known dimension. It passes at <= 1% error and the result is stored.
4. Distance, perimeter, polygon area, and roof area (plan area × √(1+(rise/12)²), with pitch entered by the user).
5. Snapping to PdfCraft vector geometry (endpoint > midpoint > path). Points can be dragged to correct them.
6. Measurements are saved in `plan_measurements`, with a full revision log in `plan_measurement_revisions` (trigger).
7. Approve, then **Send to takeoff**, which inserts a verified `commercial_takeoff_quantities` row (`source = plan_measured`). The existing estimate and budget flow uses it from there.
8. **Save measured copy** writes ISO 32000 measurement annotations through PdfCraft as an incremental save. It reads them back to verify, stores a new versioned document, and never changes the original.

### Hard rules (enforced in DB trigger `plan_measurement_guard`)
- Measured sources need a scale on the same document and page.
- Approval and export need a verified scale.
- `ai_estimated` can never be approved.
- Exported measurements are geometry-locked.
- Sources are kept separate: `manual_calibrated`, `vector_snapped`, `ocr_derived`, `ai_estimated`. OCR and AI producers aren't wired to this screen yet.

### Rollout
`src/lib/plan-measure/featureGate.ts`: on in preview/dev. On the production domain it's off unless `localStorage['pitch.planMeasure']='1'`.

## Capability matrix (Phase 1)
| Capability | Status |
|---|---|
| PdfCraft WASM measuring math (calibrate, length, perimeter, area) | Working · Tested (node + browser) |
| View/user transforms with Rotate, CropBox, UserUnit | Working · Tested (PdfCraft = JS to 1e-9, 4 rotations × 2 UserUnits) |
| Vector geometry extraction + snapping | Working · Tested on synthetic rotated/cropped sheet; Limited on huge sheets (engine caps, shown as "truncated") |
| Embedded ISO measurement annotations, save + reopen | Working · Tested (round-trip, original bytes preserved) |
| Scale calibration, stated ratio, viewport scales, 1% verification gate | Built · Unit-tested math; screen not yet tested signed-in |
| Persistence, revisions, approve → takeoff export | Built · DB trigger rules in place; not yet tested signed-in |
| OCR-derived / AI-estimated quantities in this screen | Not implemented (enum + gate only) |
| Acrobat interoperability of saved annotations | Not tested |
| Real commercial plan sets (CAD exports, scans, mixed scales) | Not tested — needs user fixtures |

Tests: `tests/plan-measure/measure-engines.test.ts` (26 passing).

## Next phases (in order)
Page Tools → Markup Tools → Revision Compare → OCR/Conversions → Batch Workflow Automation.
