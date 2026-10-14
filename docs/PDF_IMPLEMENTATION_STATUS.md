# PDF Implementation Status

Statuses: **Built** (code + synthetic tests), **Verified** (signed-in, real document), **Missing**. Nothing is Verified yet.

## Built
Page Organizer, Markup Editor, Fill & Sign / form editor, original-text editor, measurement (native PdfCraft WASM), comparison (raster, comments, measurements, saved records, review items), OCR (6 Latin languages, rotated pages), Convert to PDF, Protect, Redact, Compress & Repair, Batch tasks.

## Rollout switches
All PDF Studio switches now live in one registry: `src/lib/pdf-pages/featureGate.ts` (`isPdfToolEnabled`). Production defaults: Organize Pages on; every other tool off until verified. A per-browser override is kept for acceptance testing only.

## Fixed in this pass
- Removed the stale "Original text editing is unavailable" constant that contradicted the working, tested editor.
- Replaced six copy-pasted switch functions with one registry and explicit production defaults.

## Missing (from upstream inventory)
XFA, digital signing, preflight/validation, accessibility tagging, XFDF import/export, PDF→Office export, deskew, non-Latin OCR text layer, print-production controls.

## Known limitations and cause
| Limitation | Cause | Path to fix |
|---|---|---|
| Text edits limited to glyphs already in the font | Subset fonts lack other glyphs; adding glyphs means rewriting the embedded font program | Permissive font subsetter (fontkit) — research |
| Markup text Helvetica-only | Standard-14 font, WinAnsi encoding | Embed a permissively licensed Unicode TTF via fontkit |
| Redaction rasterizes the whole marked page | Object-level content removal not implemented | PdfCraft `redact` crate → WASM (license OK, build untested) |
| No digital signatures | No signing engine | PdfCraft `sign` crate or a separately approved service |
| Signed-in verification | No signed-in session in the test environment | User session / test account |
