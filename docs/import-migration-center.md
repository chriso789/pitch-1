# Import & Migration Center

**Status: Phase 1 shipped (staging-only). Phases 2 and 3 not built.**

## Phase 1 (shipped)

Master-only pipeline for moving data from JobNimbus, AccuLynx, Roofr, QuickBooks, CompanyCam, Jobber, Housecall Pro, or generic CSV/XLSX exports into Pitch CRM **through staging**. Nothing is written to live production tables in this phase.

### Pipeline

```
create batch → signed upload → schema detect → parse to staging
   → validate → detect duplicates → dry-run summary
```

### Tables

`import_batches`, `import_files`, `import_field_maps`, `import_staging_records`, `import_validation_errors`, `import_duplicate_reviews`, `import_file_queue` (empty in P1), `import_audit_log`, `import_rollback_items` (empty in P1), `import_templates`. All master-only RLS.

### Storage buckets

- `imports` — raw uploads, private, path = `{tenant_id}/imports/{batch_id}/{filename}`
- `import-quarantine` — files that couldn't be linked (Phase 2)

### Edge function

ONE grouped function `import-api` (no per-action functions added). Routes:

| Method | Path | Purpose |
|---|---|---|
| POST | `/batches` | create batch |
| GET | `/batches` | list batches |
| GET | `/batches/:id` | batch detail + errors + dupes |
| GET | `/batches/:id/status` | progress |
| POST | `/batches/:id/upload-url` | signed upload URLs |
| POST | `/files/:id/detect-schema` | header inspection + suggested mapping |
| POST | `/files/:id/parse` | parse CSV → `import_staging_records` |
| POST | `/batches/:id/validate` | run validators, write `import_validation_errors` |
| POST | `/batches/:id/detect-duplicates` | match against live contacts, write `import_duplicate_reviews` |
| POST | `/batches/:id/dry-run` | counts summary |
| POST | `/duplicates/:id/decide` | merge / skip / create_new |

All routes call `authMaster()` which validates JWT, requires the `master` role, and resolves tenant from the user's profile — `tenant_id` is **never** trusted from the request body. Every query explicitly filters `.eq('tenant_id', ctx.tenantId)`.

### Frontend

`src/pages/developer/ImportCenter.tsx` — wire under AI Admin Command Center as a master-only route (e.g. `/admin/import-center` or `/developer/import-center`). Phase 1 ships three live tabs (New Import, Import Jobs, Run Pipeline) and two disabled stubs (File Queue, Rollback).

## Phase 2 (planned, not built)

- `POST /batches/:id/commit` — write valid+non-duplicate staging rows into live `contacts`, `jobs`, `invoices`, etc. with full audit + rollback record per write.
- `POST /files/process` (worker) — drain `import_file_queue`, sha256 dedup, move into `documents` / `job-photos` / `invoice-files` / `measurement-reports`.
- `POST /batches/:id/rollback` — consume `import_rollback_items`. Payment records require dev override.
- XLSX / ZIP / JSON parsers.

## Phase 3 (planned, not built)

- Vendor-specific schema detectors (JobNimbus ZIP, AccuLynx export, Roofr PDF bundles, QuickBooks IIF/CSV).
- Auto-merge for high-confidence duplicates.
- Migration Report PDF export.

## Why one grouped function

Project is at 461/500 edge functions. Per `pitch-crm-architecture-guard` and `edge-function-consolidator` skills, new backend work must extend an existing or single new grouped function — never one function per action. `import-api` is +1; the spec's original 11 functions would have been +11.
