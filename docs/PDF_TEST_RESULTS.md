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
