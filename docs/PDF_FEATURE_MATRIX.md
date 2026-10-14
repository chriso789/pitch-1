# PDF Feature Matrix

Upstream: `storytold/pdfcraft` (Rust, MIT OR Apache-2.0) — 31 crates listed via GitHub API on 2026-10-14. Secondary reference `PDFCraftTool/pdfcraft` is AGPL-3.0: concepts only, no code.

Columns: **Real engine** = what actually executes in PITCH. "Native PdfCraft" means the Rust crate compiled to WASM (`engines/pdfcraft-measure-wasm`). Everything else is an independent JavaScript implementation. **Tests** = automated fixture tests (synthetic). **Production verified** = signed-in run on a real company document; nothing qualifies yet.

| Feature | Upstream implementation | PITCH implementation | Real engine used | UI connected | Tests passed | Production verified | Blocker |
|---|---|---|---|---|---|---|---|
| Measurement (calibrate, reading, view↔user, snapping, embed/list annots) | `crates/measure` | `src/lib/plan-measure` (`MeasureEngine`) | Native PdfCraft WASM; JS fallback labelled in UI | Yes — commercial Plan Measure | Yes | No | Signed-in run on known-dimension sheets |
| Low-level object model / COS | `cos`, `model`, `filters` | pdf-lib | pdf-lib (JS) | n/a | Yes | No | — |
| Rendering / navigation | `render`, `engine` | pdf.js | pdf.js (JS) | Yes | Partial | No | Render-parity check vs PdfCraft not done |
| Page organize (merge/split/reorder/rotate/crop/resize/stamps/bookmarks) | `organize` | `src/lib/pdf-pages/pageOps.ts` `compilePlan` | pdf-lib (JS) | Yes — Organize Pages | Yes | No | Signed-in test |
| Annotations / markup | `annot`, `xfdf` | `src/lib/pdf-markup/markups.ts` | pdf-lib (JS) | Yes — Markup & Annotate | Yes | No | Unicode font embedding; rotated-annot interop; no XFDF import/export |
| Original text editing | `content`, `edit` | `src/lib/pdf-engine/contentTextEdit.ts` + `textVerify.ts` | pdf-lib + pdf.js second-reader check | Yes — Edit PDF text inspector | Yes | No | Only glyphs already in the font; Type3/complex CMaps read-only |
| Font parsing / glyph handling | `fonts` | `textCapabilities.ts`, `contentTextEdit.ts` font maps, `@pdf-lib/fontkit` | JS | Indirect | Yes | No | No new-glyph subsetting into existing fonts |
| AcroForm fill | `forms` | `fillSign.ts`, `formEditing.ts` | pdf-lib (JS) | Yes — Fill & Sign / form editor | Yes | No | Signed-in test |
| XFA forms | `xfa` | none | — | No | — | No | Not implemented |
| Digital signatures | `sign` | none (signature fields reported unsupported) | — | No | — | No | Needs signing library + certificate handling; not built |
| Encryption / protect | `crypt` | `src/lib/pdf-protect/protect.ts`, `decrypt.ts` | qpdf WASM (JS host) | Yes — Protect | Yes | No | Signed-in test |
| Redaction (true removal) | `redact` | `src/lib/pdf-redact/redact.ts` | pdf-lib + pdf.js rasterize | Yes — Redact | Yes | No | Rasterizes whole marked page (not object-level) |
| OCR | `ocr` | `src/lib/pdf-ocr/*` | tesseract.js (JS/WASM) | Yes — Scan to Text, batch step | Yes | No | Non-Latin scripts (WinAnsi-only layer) |
| Optimize / compress / repair | `optimize` | `src/lib/pdf-health/health.ts` | pdf-lib + canvas (JS) | Yes — Compress & Repair | Yes | No | Deskew not built; CMYK images untouched |
| Compare | `compare` | `src/lib/pdf-compare/*` | pdf.js raster diff + JS annot/measure diff | Yes — Compare (gated) | Yes | No | Signed-in save test |
| Create / convert to PDF | `create` | `src/lib/pdf-convert/toPdf.ts` | pdf-lib + mammoth (JS) | Yes — Convert to PDF | Yes | No | Standard fonts only; .doc unsupported |
| Export (images/text) | `export` | OCR panel export images/text | pdf.js (JS) | Yes | Partial | No | No PDF→Word/Excel |
| Automation / batch | `automation` | `src/lib/pdf-batch/workflow.ts` | JS | Yes — Batch tasks | Yes | No | Signed-in test |
| Preflight / validation | `preflight` | none | — | No | — | No | Not implemented |
| Accessibility / tagging | `a11y` | none | — | No | — | No | Not implemented |
| Print | `print` | browser print only | — | Partial | — | No | No print-production controls |
| Audit | `audit` | `PdfAuditEngine.ts` + version metadata | JS | Partial | Partial | No | Not reviewed |
| PDF JavaScript | `js` | none (intentionally) | — | No | — | No | Security: not planned |
| Geometry | `geom` | inside `plan-measure` | Native (via measure) | Indirect | Yes | No | — |
| Desktop UI | `ui-egui`, `platform` | n/a (web app) | — | — | — | — | Not applicable |

## Code needing review (possibly unused or legacy)
`src/lib/pdf-editor/apryseAdapter.ts` (paid SDK adapter — not licensed, must stay unused), `PdfCollaborativeEngine.ts`, `PdfBinaryRebuilder.ts`, `PdfAiRewriter.ts`, the older `src/pages/PdfEngineEditor.tsx` path alongside `PdfWorkspaceEditor.tsx`. None are removed until their routes are traced.
