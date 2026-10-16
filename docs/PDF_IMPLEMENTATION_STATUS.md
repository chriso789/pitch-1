# PDF Implementation Status

Statuses: **Built** (code + synthetic tests), **Verified** (signed-in, real document), **Missing**. Nothing is Verified yet.

## Built
Page Organizer, Markup Editor, Fill & Sign / form editor, original-text editor, measurement (native PdfCraft WASM), comparison (raster, comments, measurements, saved records, review items), OCR (6 Latin languages, rotated pages), Convert to PDF, Protect, Redact, Compress & Repair, Batch tasks.

## Rollout switches
Per company, in Settings → PDF Tools (`/settings/pdf-tools`), changeable only by owner/corporate/office admin/master. Stored in `tenant_pdf_tool_settings`; the database refuses to save a PDF version or conversion made with a tool that is off for that company. Defaults: page tools on, everything else off. The browser override was removed.

Not yet executed: signed-in cross-company test of these switches (no test account in this environment).

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

## UltraScan mobile reliability (2026-10-16)
| Milestone | Status | Implementation | Evidence |
|---|---|---|---|
| A Background processing, progress, cancel | Done (software) | `src/lib/scan-restore/restoreAsync.ts`, `restore.worker.ts`, `batchRunner.ts`; progress bar + Cancel in `DocumentScannerDialog.tsx` page editor | restore-async, mobile-reliability tests |
| A Memory pressure | Done (software) | `src/lib/scan-records/memoryBudget.ts` limits parallel pages by device memory; originals never dropped | mobile-reliability |
| A Orientation | Transform math done; browser viewport test pending (scanner is sign-in only) | `src/lib/scan-records/orientation.ts` | mobile-reliability |
| B Recovery/upload | Done (software) | `src/lib/scan-records/uploadRetry.ts` wired into PDF + original-photo uploads (retry, session refresh, quota/permission messages); `uploadIdentity.ts`; `scannerSessionStore.ts` | upload-recovery |
| C Security | Harness built; **live run pending** (needs 2 test companies) | `tests/scanner/security-harness.test.ts` | 7 skipped |
| D Benchmark | Synthetic done; real-photo/OCR CER pending | `tests/scanner/shadow-benchmark.test.ts` | metrics in PDF_TEST_RESULTS |
| E Warning triage | Done; 1 high fixed (satellite storage writes) | `docs/SECURITY_WARNING_TRIAGE.md`, migration | live policy query |
| F Final acceptance | **Pending** — five-page signed contract on a real phone | — | — |
