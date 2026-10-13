# PITCH PDF text-editing audit — 13 October 2026

## Result
**Genuine page-text replacement with exact original fonts is not implemented.** The current engines draw a rectangle over old text and add replacement text. The old text remains extractable. No licensed SDK was installed, activated, or purchased.

## Traced execution
| Stage | Actual behavior |
|---|---|
| `PdfEngineEditor` | Uses `usePdfEngineV2`, `pdf_documents`, `PdfCanvas`, `PdfCompiler`. |
| `PdfWorkspaceEditor` | Separate `usePdfEngine`, `pdf_workspace_documents`, `PdfOverlayEditor`, lowercase `compiler.ts`. |
| Parsing | `PdfObjectParser` uses PDF.js strings/transforms/font aliases; it does not capture encodings, source operator offsets, font programs, or glyph maps. |
| Selection | Fabric overlays extracted text over an already-rendered original page. |
| Canvas typing | Both canvases accept editing but do not connect `editing:exited` to their text callbacks. Changes disappear on redraw and never reach operations. |
| Sidebar replacement | Stores an operation, but the compiler only white-outs and redraws in Helvetica/Helvetica Bold. |
| `PdfOperationEngine` | Stores operations; `applyOperationPreview` only clones objects, without applying them. |
| `PdfFontEngine` | Font-name fallback and approximate widths, not embedded-font extraction/reuse. PDF.js aliases are not original font identities. |
| `PdfBinaryRebuilder` | Even its former `true_reconstruction` result used white-out/redraw. It now returns an overlay result and warning for that request. |
| Coordinates | Legacy coordinate mapper ignores its rotation field; workspace overlays use raw coordinates on a top-down canvas. Newly exposed text inspection uses PDF.js viewport matrices, including crop/rotation. |
| Versions | Source binaries are preserved; new outputs have separate storage paths. This does not by itself prove faithful editing. |
| Optional adapter | `apryseAdapter` is an unimplemented throwing stub. |

Independent Poppler `pdftotext` tests confirm original AND replacement text remain in outputs from both compilers and the rebuilder. These are tests of the limitation, not evidence that genuine replacement works.

## PDFCraft audit
Locally integrated Rust/WASM exposes calibration, measurement geometry and measurement annotations—not text replacement or font embedding. See `engines/pdfcraft-measure-wasm`, its pinned dependency manifest, and `docs/PDFCRAFT_INTEGRATION.md`.

Upstream `storytold/pdfcraft` has editing work, but its roadmap and issue #906 describe added/edited text limited to Helvetica, Times and Courier and font embedding as unfinished. The edit/font/render crates are not integrated or browser-tested in PITCH. Adopting their names alone would not solve exact-font editing.

References inspected during research:
- https://github.com/storytold/pdfcraft/blob/main/ROADMAP.md
- https://github.com/storytold/pdfcraft/issues/906
- https://apryse.com/pricing
- https://www.nutrient.io/guides/web/pspdfkit-for-web/licensing/

`storytold/pdfcraft` is MIT OR Apache-2.0, subject to dependency/asset review. The separate `PDFCraftTool/pdfcraft` is AGPL-3.0 and must not be copied into proprietary PITCH without a compliance/licensing decision.

## Exact technical gaps
1. A tokenizer/content-stream parser that identifies the correct `Tj`, `TJ`, quote operators and nested Form XObjects, respecting graphics/text state.
2. Reverse Unicode-to-source encoding, ToUnicode/CMap/CID mapping, widths, font programs, and permitted embedding.
3. Replacement layout with unchanged unaffected runs, kerning, positioning, clipping and overflow detection.
4. Subsets can lack newly typed glyphs. Exact font requires an available and permitted full font program, or refusing the change—not silent substitution.
5. Scans and outlined glyphs have no editable text/font to recover. OCR recognizes wording, not the exact source font.
6. Independent extraction/render checks proving old runs are removed, including signed/encrypted/malformed/CAD/complex-script PDFs.

## Supported improvements delivered
- **Edit PDF** appears in Company Docs, tagged documents, the actual Smart Tag document editor, workspace editor, and the stored-document tools. It exposes selectable original text and font diagnostics, explicitly read-only, rather than pretending to replace it.
- **Fill Forms** writes genuine AcroForm text/checkbox/choice values and verifies them after reopening. Original page text is untouched. Standard form appearances are disclosed; unsupported characters and read-only fields block output. Digital signing is not implemented.
- Markup export now rejects unsupported characters instead of changing them to `?`.
- Organize Pages and annotations remain available; new versions remain separate from originals.

## Costs and alternatives — estimates, not offers
| Alternative | License | Integration estimate |
|---|---|---|
| Apryse Web SDK with content editing | Custom quote required for PITCH's modules/deployment/volume. A public entry-package floor is not a quote for content editing. | Approximately 2–6 engineer-weeks for a first edit/save/reopen integration, plus legal/security and regression QA. |
| Nutrient Web SDK with document editing | Custom quote/usage terms; verify content editing, hosting and font rights in the actual offer. | Approximately 2–6 engineer-weeks under the same assumptions. |
| Internal content parser/font engine | No commercial SDK fee; significant specialist engineering and maintenance. | Not responsibly fixed-price estimable without a constrained proof of concept and representative source files. |
| Upstream PDFCraft expansion | Permissive core licensing; dependency review required. | R&D until needed font capabilities and WASM builds are independently proven; not a guaranteed sprint. |

At an **illustrative** external engineering rate of $100–$150/hour, 80–240 hours corresponds to **$8,000–$36,000 engineering cost**, excluding SDK licensing. This is not a PITCH charge or vendor quote. Exact-font behavior still requires representative-file testing even with a commercial engine.

## Verification and remaining blockers
- Automated fixtures: regular text PDF, image-only scan, embedded subset/Type0 resource classification, genuine fillable forms, unsupported Unicode, read-only fields, choice validation, and immutable source bytes.
- Synthetic embedded-font resource tests verify diagnostics only, not real font editing.
- All 26 targeted tests pass. Browser fixture testing selected actual embedded-font text, filled an AcroForm field, downloaded the result and reopened it in the forms UI. Independent Poppler extraction and rendering confirmed the saved field and preserved page text. Visual QA found no clipped text, overlap or font-rendering defects in that fixture; this is not a test of the customer's certificate or authenticated storage.
- Initial audit-test issues were corrected: global setup requires jsdom, and Poppler raw extraction avoids layout-induced interleaving of overlapping original/replacement runs. These test adjustments do not make the overlay engines genuine editors.
- User insurance certificate `ff276039-3b03-4955-8c83-663af39ced92`: no uploaded source located; this external unmanaged Supabase project has no available authenticated test session. No authenticated certificate editing/storage/reopen claim is made.
- Digital signatures, conversions/OCR and drawing comparison remain roadmap work, not completed by this audit.
- GitHub synchronization is managed by Lovable; no manual commit/push or commit hash was produced.

No further paid-license authorization is requested during this audit.