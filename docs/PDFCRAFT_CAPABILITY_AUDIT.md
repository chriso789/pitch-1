# PITCH PDF capability audit — 2026-10-12

## Separate upstream projects (do not confuse them)
- `storytold/pdfcraft` — https://github.com/storytold/pdfcraft, Rust, MIT OR Apache-2.0; inspect NOTICE, ATTRIBUTION, individual vendored dependency licenses. Its ArtCraft marks/assets are separately restricted.
- `PDFCraftTool/pdfcraft` — https://github.com/PDFCraftTool/pdfcraft, Next.js/React, AGPL-3.0; README *advertises* 90+ tools including workflow chains, OCR, conversions, organize, edit, and PDF compare. README claims are not a tested functionality guarantee.

**License hold:** Do not copy AGPL-3.0 code into proprietary PITCH or deploy derived network features without counsel's licensing review and compliance plan. Re-implement concepts independently, or seek an alternative license. Preserve provenance and attribution for any incorporated code. The Rust repository also needs dependency-by-dependency review.

## Current working proof of concept in PITCH
Browser-only operations with existing `pdf-lib`: merge, range extraction, page rotation, reverse page order, page numbers, basic watermark, title metadata. This is *not* the Rust engine and not full PdfCraft. Existing PDF routes remain intact.

## Priority order
1. **Construction accuracy** — integrate dedicated Rust `crates/measure` only after verifying build/runtime suitability. Its upstream README documents Line/PolyLine/Polygon PDF annotations, per-measurement scale, viewport selection, UserUnit and crop/rotation handling, snapping and CSV export. Limitation: raster outlines, glyph outlines and layer visibility are not interpreted; Acrobat interoperability is untested. Require dimension-control QA on plans with mixed sheet sizes, drawing scales, page rotations, PDF UserUnit and revisions. Never treat an OCR dimension as calibrated geometry.
2. **Page fidelity** — compare render outputs across PDF.js and PdfCraft on real architectural/structural/roofing plan sets; ensure embedded text, vector geometry, annotations and optional content groups survive unchanged.
3. **Editing/annotation** — highlights, shapes, stamps, text entry, forms, page layout. Preserve provenance, revision history and immutable signed originals.
4. **Batch workflow engine** — inspired by PDFCraftTool's node-based workflow concepts (README describes 23+ templates). Create independent implementation with type-checked operations, previews, tenant isolation, audit logs and bounded jobs. Do not copy AGPL code without review.
5. **Conversions/OCR/redaction** — capability-gate by fidelity and regression tests; genuine redaction must erase content, not place opaque shapes.
6. **Security and commercial deployment** — input size limits, malformed PDF fuzz testing, permission evaluation, strict storage tenancy, retention and legal audit.

## Release acceptance
- Build and typecheck pass; PDFs opened with external readers.
- Verify 30 representative PDFs including: encrypted, scanned, vector CAD exports, signed, oversized plan sheets, rotated/cropped, corrupt, attached files and optional content.
- Validate physical distances against known sheet dimensions. Record coordinate transform formula and confidence; reject unknown scales.
- Verify Adobe interoperability for roundtripped annotations/forms and unchanged originals.
- Run test suites and end-to-end tasks before merging PR.
- No advanced PDF functionality marked enabled unless the specific tested engine powers it.

## Upstream references
- https://github.com/storytold/pdfcraft/tree/main/crates/measure
- https://github.com/storytold/pdfcraft/tree/main/crates/render
- https://github.com/storytold/pdfcraft/tree/main/crates/organize
- https://github.com/storytold/pdfcraft/tree/main/crates/annot
- https://github.com/PDFCraftTool/pdfcraft#complete-tool-list-90-tools
