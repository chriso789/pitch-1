# PDF Test Results

## 2026-10-14 — base commit 845185e7cc96f80afb507ad734ca1daa7ef5af36
Command: `npx vitest run tests/pdf-engine tests/pdf-compare tests/pdf-ocr tests/pdf-protect tests/pdf-redact tests/pdf-health tests/pdf-batch tests/pdf-convert tests/pdf-markup`
Result: **18 files, 60 tests passed, 0 failed.**

All fixtures are synthetic (generated with pdf-lib/fontkit). This is not production acceptance.

## Not yet run (required before any production release)
- Signed-in document workflows and cross-company isolation (no signed-in session available to the test environment)
- Real architectural drawings with known dimensions, CAD vector exports, scanned sets, rotated/cropped sheets
- Mixed font encodings from real third-party files
- Existing digital signatures preserved after edits
- Adobe Acrobat round-trip

## 2026-10-16 — UltraScan mobile reliability milestone (base 3e93ec5dcdbf2df09ea029c7b20cb4024d4c9941)
Command: `npx vitest run tests/scanner`
Result: **12 files, 75 passed, 0 failed, 7 skipped.** Skipped = live two-company harness (no test accounts).
- `mobile-reliability.test.ts` (13): batch progress/cancel/error isolation/concurrency cap; memory budget; rotate 0/90/180/270 corner round-trip; portrait/landscape page size; preview→source mapping for 390×844 and 844×390.
- `upload-recovery.test.ts` (17): error classification (network/auth/quota/duplicate/permission); network drop + reload retry → 1 PDF, 5 originals, 1 row; session refresh; quota not retried; offline retry limit; per-company upload ids; draft reload keeps reordered order; quota keeps previous draft; expiry purge.
- `shadow-benchmark.test.ts` (7): synthetic page (text, fine print, faint signature, checkbox, fold, hard shadow, vignette). Shadow residual input 83.7 → auto 20.1, ultraClean 23.4, originalColor 20.0, grayscale 20.1, **bw 41.9 (defect: speckle in hard shadow)**. Faint signature contrast kept ≥69 in all modes. Original mode byte-identical. Timing (jsdom, 600×800): 47–223 ms.
- `security-harness.test.ts`: 7 live cases **skipped — NOT verified**.
Not measured: OCR character error rate, peak memory, crop accuracy on real photos, neural cleanup models (licenses unchecked; none added).
