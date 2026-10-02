# Blueprint F1 Runtime Wiring Contract

Status: F1A-F1F shared runtime foundation implemented; live `document-worker /parse/blueprint` route integration remains intentionally pending.

## Purpose

The F1 runtime converts an uploaded blueprint PDF into persistence-ready page layout, sheet intelligence, drawing viewports, cross-sheet references, specification candidates, and dimension/geometry primitives without producing approved takeoff quantities.

## Runtime modules

- `pdf-layout.ts` — positioned PDF text + page dimensions.
- `blueprint-sheet-intelligence.ts` — title-block, sheet number/title, discipline, normalized scale, sheet-index extraction.
- `blueprint-viewports.ts` — local drawing viewport detection + local scale ownership + detail/section/sheet reference extraction.
- `blueprint-spec-intelligence.ts` — deterministic construction specification candidates with normalized values and source evidence.
- `blueprint-dimensions.ts` — explicit dimension parsing plus calibrated segment length / polygon area helpers that require a valid architectural viewport scale.
- `blueprint-f1-runtime.ts` — composes layout + sheet/viewports/references into persistence-ready runtime output and review summary.
- `blueprint-f1-persistence.ts` — tenant-safe persistence to `plan_pages`, `plan_sheet_index_entries`, `plan_drawing_viewports`, and `plan_detail_refs`; preserves user-confirmed/dismissed rows.
- `blueprint-spec-dimension-persistence.ts` — persistence adapter for `plan_specs` and `plan_dimensions` candidates.

## Intended document-worker wiring

After the existing blueprint PDF bytes are downloaded in `POST /parse/blueprint`:

1. Call `analyzeBlueprintPdfF1(bytes)`.
2. Call `persistBlueprintF1Result(serviceClient, tenantId, document_id, result)`.
3. For each analyzed layout page, run spec + dimension extraction using that page's detected viewports.
4. Persist candidates to `plan_specs` / `plan_dimensions` with source evidence and review status.
5. Use `result.requires_review` as an additional review condition, never as a reason to auto-approve geometry.
6. Include runtime summary, missing indexed sheets, and unresolved reference targets in the route response/status message.

## Measurement safety gates

- Explicit dimension text may normalize directly to feet because the printed drawing dimension is the measurement source.
- Scaled segment lengths require a viewport with a valid architectural scale; otherwise the helper returns `null`.
- Polygon area requires the same valid viewport scale; otherwise the helper returns `null`.
- PDF text bounding boxes are not construction geometry and must never be treated as roof/wall/floor outlines.
- `vector_extraction_status='deferred'` remains explicit; vector-line detection is not claimed in F1.
- OCR remains deferred for image-only sheets.

## Specification safety gates

- All deterministic spec detections are candidates with `requires_review=true`.
- Source text, page, bbox, viewport key, confidence, and normalized value are retained.
- No detected product/system becomes a catalog item, estimate line, purchase order item, or final scope automatically.

## Global safety gates

- No estimate or proposal writes.
- No material/labor pricing changes.
- No CRM handoff.
- No geometry emitted from text coordinates alone.
- No existing user-confirmed/dismissed intelligence row is overwritten on deterministic rerun.
