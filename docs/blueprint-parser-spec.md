# Blueprint Parser Spec (Slice 2B)

Deterministic, no-AI blueprint pipeline. Replaces `parse-blueprint-document`
and `classify-blueprint-pages` with routes on the grouped `document-worker`
function. Source-of-truth tables remain `plan_documents` and `plan_pages`.

## Routes

### `POST /parse/blueprint`
**Auth:** authenticated tenant route (`requireAuth` + `requireTenant`).
**Tenant guard:** verifies `plan_documents.tenant_id === resolvedTenantId` before any read/write.
**Body:** `{ document_id: string }`.
**Pipeline:**
1. Set `plan_documents.status = 'classifying'`.
2. Download `plan_documents.file_path` from the `blueprints` storage bucket via service role.
3. Extract per-page text via `_shared/parsers/pdf-text.ts` (unpdf, no canvas).
4. For each page, run `_shared/parsers/blueprint-classifier.ts` (deterministic regex rules).
5. Upsert into `plan_pages` on `(document_id, page_number)` with: `raw_text` (≤8000 chars), `page_type`, `page_type_confidence`, `sheet_number`, `sheet_name`, `scale_text`.
6. Update `plan_documents.page_count`, `status` (`ready_for_review` if any page below review floor, else `extracting_geometry`).
7. Insert `document_parser_runs` row (parser_name `blueprint-classifier`, tier `deterministic`).
8. If any page requires review, insert a `document_review_queue` row.
9. If no review needed, chain `extract-roof-plan-geometry` (preserves legacy behavior).

**Response (`ok:true, data`):**
```jsonc
{
  "document_id": "uuid",
  "page_count": 12,
  "classified_pages": [
    {
      "page_number": 1,
      "page_type": "cover_sheet",
      "confidence": 0.7,
      "sheet_number": "A-001",
      "sheet_name": "COVER SHEET",
      "scale_text": null,
      "requires_review": false
    }
  ],
  "confidence_score": 0.62,
  "requires_review": false,
  "ai_fallback": "deferred"
}
```

### `POST /classify-pages`
Re-runs the deterministic classifier against existing `plan_pages.raw_text`
without re-downloading the PDF. Same auth + tenant guard. Same response shape
but `results` instead of `classified_pages`.

## Page types (deterministic enum)

`roof_plan`, `framing_plan`, `detail_sheet`, `specification_sheet`,
`section_sheet`, `schedule_sheet`, `cover_sheet`, `irrelevant`, `unknown`.

> The spec brief listed `floor_plan`, `elevation`, `wall_section`, `notes`.
> The active legacy schema uses the enum above; classifier mappings will be
> extended in Slice 2D alongside the table-merge migration. New types must
> not be emitted until DB constraints accept them.

## Confidence rules

- Per-page score is sum of matched rule-group weights, capped at 0.99.
- Pages with `< CONFIDENCE_THRESHOLDS.REVIEW_FLOOR` (0.45) are flagged `requires_review: true`.
- Pages with `< 0.20` total score collapse to `page_type = "unknown"`.
- A run is `low_confidence` if **any** page requires review; `succeeded` otherwise.
- A `low_confidence` run does **not** auto-chain geometry — the document waits for human review.

## Tenant & security guarantees

- `tenant_id` is resolved from JWT only; never read from request body.
- Storage download path comes from the verified `plan_documents.file_path`; no path is accepted from clients.
- All `plan_pages` / `plan_documents` writes are scoped with `.eq('tenant_id', tenantId)` even though service role is used.
- Audit log: every call writes to `edge_function_audit` via the shared router.
- Failures update `plan_documents.status='failed'` with a truncated `status_message`.

## What is NOT done in Slice 2B

- AI fallback (Tier 4) — `/ai-fallback` still returns `501 ai_fallback_deferred`.
- OCR for image-only PDFs — flagged with `no_text_extracted` and queued for review.
- Migration of `upload-blueprint-document` — tracked in `document-parser-route-map.md`.
- Consolidation of `extract-roof-plan-geometry`, `extract-blueprint-specs`, `link-blueprint-details`, `review-blueprint-page`, `get-blueprint-document` — deferred to Slice 2D.
