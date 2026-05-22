# Document Parser Route Map (Slice 2B)

| Frontend / caller | Old function | New routed call |
|---|---|---|
| Roof report ingest UI | direct upload + `parse-roof-report` | `edgeApi("document-api", "/ingest/upload", payload)` (auto-parses) |
| Document status panel | bespoke polling | `edgeApi("document-api", "/documents/status", { document_id })` |
| Extraction viewer | n/a (new) | `edgeApi("document-api", "/documents/extracted-data", { document_id })` |
| Reprocess button | manual re-invoke | `edgeApi("document-api", "/documents/reprocess", { document_id })` |
| Approve extraction | n/a (new) | `edgeApi("document-api", "/documents/approve-extraction", { document_id, change_note? })` |
| Version history | n/a (new) | `edgeApi("document-api", "/documents/versions", { document_id })` |
| Link document → job | direct UPDATE | `edgeApi("document-api", "/documents/link-to-job", { document_id, project_id? \| pipeline_entry_id? \| contact_id? })` |
| Direct PDF parse (storage path) | `parse-roof-report` body shape varied | `edgeApi("document-worker", "/parse/roof-report", { bucket, path })` |
| Raw PDF text | `pdf-extract-text`, `pdf-parse` | `edgeApi("pdf-api", "/extract-text", { document_id })` or `{ bucket, path }` |
| **Blueprint parse pipeline** | `parse-blueprint-document` | `edgeApi("document-worker", "/parse/blueprint", { document_id })` |
| **Blueprint reclassify pages** | `classify-blueprint-pages` | `edgeApi("document-worker", "/classify-pages", { document_id })` |

## Legacy shims active

| Old folder | Forwards to | Notes |
|---|---|---|
| `pdf-extract-text` | `pdf-api /extract-text` | |
| `pdf-parse` | `pdf-api /parse` | |
| `parse-roof-report` | `document-worker /parse/roof-report` | Only when payload has `document_id` / `bucket` / `storage_path`. Legacy `{measurements}` callers must call `generate-estimate-from-measurement` directly — shim returns HTTP 410 `migration_required`. |
| `parse-blueprint-document` | `document-worker /parse/blueprint` | Deterministic-only. Writes `plan_pages`, updates `plan_documents`, chains `extract-roof-plan-geometry`. |
| `classify-blueprint-pages` | `document-worker /classify-pages` | Re-classifies existing `plan_pages` rows deterministically (no re-extract). |

## Not migrated this slice (intentional)

| Function | Reason | Slice |
|---|---|---|
| `upload-blueprint-document` | Writes to `plan_documents` + `plan_parse_jobs` tables, distinct from the `documents` table that `document-api /ingest/upload` manages. Migrating requires a table-merge migration. Frontend still calls it via `invoke()` and that call site is documented in `src/integrations/blueprintApi.ts`. | 2D+ |
| `extract-roof-plan-geometry`, `extract-blueprint-specs`, `link-blueprint-details`, `review-blueprint-page`, `get-blueprint-document` | Geometry / specs / link consolidation belongs to a later slice; called only by Blueprint UI. | 2D+ |

## Deferred to Slice 2C / 2D

- `roof-report-ingest` wiring (Slice 2C)
- Batch reprocess / queue worker (Slice 2C)
- Blueprint upload + geometry consolidation (Slice 2D)
- AI fallback (Tier 4)
