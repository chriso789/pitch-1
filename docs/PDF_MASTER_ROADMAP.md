# PDF Master Roadmap (priority order)

1. **Frontend + security** — trace every PDF route from Smart Docs, Commercial Drawings & Files, PDF Workspace, Contracts, Proposals, Invoices, Blueprints; replace the browser-level switch with a company-scoped flag table; signed-in cross-company checks. *Blocked partly on a signed-in session.*
2. **Text & fonts** — glyph addition to subset fonts; width/advance checks for Type0 fonts; real third-party font fixtures.
3. **Page & annotation fidelity** — Unicode markup fonts; rotated-annotation interop; XFDF.
4. **PdfCraft engine gaps** — evaluate compiling `redact`, `sign`, `preflight`, `optimize` crates to WASM like `measure`.
5. **OCR & conversion** — non-Latin text layer (needs embedded Unicode font); deskew; PDF→Office.
6. **Signatures, protection, redaction** — digital signing; object-level redaction.
7. **Comparison** — signed-in save test.
8. **Batch** — signed-in test; error-handling review.
9. **Production acceptance** — real drawing sets, Acrobat round-trip; only then turn tools on in production.

No paid licenses, no production enablement without approval. Status of each item: `PDF_IMPLEMENTATION_STATUS.md`, `PDF_FEATURE_MATRIX.md`, `PDF_TEST_RESULTS.md`.

## UltraScan release blockers (2026-10-16)
1. Live two-company isolation run (`security-harness.test.ts` with SCAN_SEC_* env).
2. Five-page signed-contract test on a real iPhone and Android (cleanup, reorder, network drop, one PDF, correct company, originals kept).
3. B&W mode leaves shadow speckle (benchmark residual 41.9 vs ~20 for other modes).
4. OCR character-error-rate and peak-memory measurement on real photos.
5. Remaining high security items in `docs/SECURITY_WARNING_TRIAGE.md` (anon-executable functions, open inserts on ai_call_transcripts).
