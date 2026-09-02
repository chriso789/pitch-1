# Blueprint F1 Runtime Wiring Contract

Status: implementation-ready shared runtime; document-worker route integration pending.

## Purpose

The F1 runtime converts an uploaded blueprint PDF into persistence-ready page layout and sheet intelligence without producing approved measurements.

## Runtime modules

- `pdf-layout.ts` — positioned PDF text + page dimensions.
- `blueprint-sheet-intelligence.ts` — title-block, sheet number/title, discipline, normalized scale, sheet-index extraction.
- `blueprint-f1-runtime.ts` — composes layout + intelligence into persistence-ready rows and review summary.
- `blueprint-f1-persistence.ts` — tenant-safe persistence to `plan_pages` and `plan_sheet_index_entries`; preserves user-confirmed/dismissed index rows.

## Intended document-worker wiring

After the existing blueprint PDF bytes are downloaded in `POST /parse/blueprint`:

1. Call `analyzeBlueprintPdfF1(bytes)`.
2. Call `persistBlueprintF1Result(serviceClient, tenantId, document_id, result)`.
3. Use `result.requires_review` as an additional review condition, never as a reason to auto-approve geometry.
4. Include `result.summary` and `missing_indexed_sheets` in the route response/status message.
5. Continue to treat `vector_extraction_status='deferred'` and image-only pages as non-measurement evidence.

## Safety gates

- No estimate or proposal writes.
- No material/labor pricing changes.
- No geometry emitted from text coordinates alone.
- No OCR claim for image-only pages.
- No existing user-confirmed/dismissed sheet-index row is overwritten on deterministic rerun.
