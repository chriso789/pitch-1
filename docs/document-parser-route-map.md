# Document Parser Route Map (Slice 2A)

| Frontend / caller | Old function | New routed call |
|---|---|---|
| Roof report ingest UI | direct upload + `parse-roof-report` | `edgeApi("document-api", "/ingest/upload", payload)` (auto-parses) |
| Document status panel | bespoke polling | `edgeApi("document-api", "/documents/status", { document_id })` |
| Extraction viewer | n/a (new) | `edgeApi("document-api", "/documents/extracted-data", { document_id })` |
| Reprocess button | manual re-invoke | `edgeApi("document-api", "/documents/reprocess", { document_id })` |
| Approve extraction | n/a (new) | `edgeApi("document-api", "/documents/approve-extraction", { document_id, change_note? })` |
| Version history | n/a (new) | `edgeApi("document-api", "/documents/versions", { document_id })` |
| Link document → job | direct UPDATE | `edgeApi("document-api", "/documents/link-to-job", { document_id, project_id? | pipeline_entry_id? | contact_id? })` |
| Direct PDF parse (storage path) | `parse-roof-report` body shape varied | `edgeApi("document-worker", "/parse/roof-report", { bucket, path })` |
| Raw PDF text | `pdf-extract-text`, `pdf-parse` | `edgeApi("pdf-api", "/extract-text", { document_id })` or `{ bucket, path }` |

## Legacy shims active this slice

| Old folder | Forwards to | Notes |
|---|---|---|
| `pdf-extract-text` | `pdf-api /extract-text` | |
| `pdf-parse` | `pdf-api /parse` | |
| `parse-roof-report` | `document-worker /parse/roof-report` | Only when payload has `document_id` / `bucket` / `storage_path`. Legacy `{measurements}` callers must call `generate-estimate-from-measurement` directly — shim returns HTTP 410 `migration_required`. |

## Deferred to Slice 2B / 2C

- `parse-blueprint-document` shim
- `classify-blueprint-pages` shim
- `src/integrations/blueprintApi.ts` migration to `edgeApi`
- `roof-report-ingest` wiring
- Batch reprocess / queue worker
- AI fallback (Tier 4)
