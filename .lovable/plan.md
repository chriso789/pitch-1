
# Pitch CRM Import & Migration Center — Phased Plan

Your spec is correct in shape, but shipping all 11 edge functions + 10 tables + 11 UI components + 6 buckets in one pass would: (a) add ~11 functions to a project already at **461/500 edge functions**, (b) ship a `import-commit-batch` that writes into ~15 production tables before staging/validation has been proven on real exports, and (c) create a rollback engine before we know what rollback actually needs to undo.

Recommend phasing. This plan covers **Phase 1 only**. Phases 2–3 are listed but not built.

---

## Phase 1 — Staging + Validation + Dry Run (this build)

Goal: a master/admin user can upload a JobNimbus / AccuLynx / Roofr / QuickBooks / generic CSV/XLSX/ZIP export, see it parsed into staging, see validation errors and duplicate candidates against live Pitch data, and see a dry-run summary of what *would* be imported. **No writes to production tables. No rollback engine yet.**

### 1. Database (one migration)

Create the 10 tables exactly as specced, with two changes:
- Add `tenant_id uuid not null` alongside `company_id` (project convention is `tenant_id` per Core memory — keep `company_id` as alias column for compatibility with the spec, but RLS keys off `tenant_id`).
- All tables get RLS: master role full access, tenant admins can SELECT/INSERT/UPDATE only their own `tenant_id` rows, no DELETE from client.
- `import_rollback_items` and `import_audit_log` created now (empty) so Phase 2 doesn't need a schema change.

Indexes as specced.

### 2. Storage (one migration)

Create buckets `imports`, `import-quarantine` (private). **Do not** create `documents`, `job-photos`, `invoice-files`, `measurement-reports` here — those already exist or will be created when needed. Phase 1 only touches `imports` + `import-quarantine`.

Storage RLS enforces `{tenant_id}/imports/{batch_id}/...` path prefix (project Core memory rule).

### 3. Edge functions — consolidated into ONE grouped function

Project is at 461/500 functions. We add **one** new grouped function `import-api` with internal routes, instead of 11 separate functions:

- `POST /batches` → create batch
- `POST /batches/:id/upload-url` → signed upload URLs
- `POST /files/:id/detect-schema` → header/sheet/zip inspection + suggested mapping
- `POST /files/:id/parse` → chunked parse into `import_staging_records`
- `POST /batches/:id/validate` → run validators, write `import_validation_errors`
- `POST /batches/:id/detect-duplicates` → match against live contacts/jobs/invoices, write `import_duplicate_reviews`
- `POST /batches/:id/dry-run` → produce would-create/would-update/blocked summary
- `GET  /batches/:id/status` → live progress
- `POST /duplicates/:id/decide` → admin merge/skip/create-new decision

All routes go through `_shared/auth.ts` (`requireMaster` or `requireTenantAdmin`) + explicit `.eq('tenant_id', resolvedTenantId)` filtering. Per-tenant scoped. No service role exposed.

**Deferred to Phase 2 (not in this build):** `commit-batch`, `file-worker`, `rollback-batch`.

### 4. Shared utilities

Under `supabase/functions/_shared/import/`:
- `fieldAliases.ts` — the alias map from your spec
- `normalizers.ts` — contact/job/invoice/budget shapes
- `validators.ts` — phone/email/address/date/amount/relationship checks
- `duplicateDetection.ts` — phone/email/normalized-address/source-id matchers against live tables
- `fileHash.ts` — sha256 streaming
- `chunking.ts` — 500–2000 row chunker
- `parsers/csv.ts`, `parsers/xlsx.ts`, `parsers/zip.ts` — streaming parsers

### 5. Frontend

One route `/developer/import-center` + `/developer/import-center/:batchId`, nested under the existing **AI Admin Command Center** (per prior decision for the Backend Maintenance Center). Master-only.

Tabs shipped in Phase 1:
1. New Import (uploader + source-system picker)
2. Import Jobs (batch list with status badges)
3. Field Mapping (grid editor over `import_field_maps`)
4. Validation Errors (filterable table + CSV export)
5. Duplicate Review (decision controls)
6. Dry Run Summary

Tabs **stubbed** (visible, "Phase 2" badge, disabled): File Import Queue, Rollback Center, Import Templates, Migration Reports.

Components: `ImportUploader`, `ImportProgress`, `FieldMappingGrid`, `ValidationErrorTable`, `DuplicateReviewTable`, `ImportDryRunSummary`. Use existing design tokens; status badges via existing `Badge` variants.

### 6. Documentation

Update `docs/edge-function-current-status.md` to record `import-api` as a new grouped function (counts toward 462/500). Add `docs/import-migration-center.md` describing the staging pipeline and the Phase 2/3 deferred work.

---

## What is intentionally NOT in Phase 1

| Item | Reason | Phase |
|---|---|---|
| `import-commit-batch` (live writes) | Need real exports validated through staging first | 2 |
| `import-file-worker` (move files to final buckets, link to contacts/jobs/invoices) | Depends on commit | 2 |
| `import-rollback-batch` | Depends on commit + audit data | 2 |
| `import_templates` reuse UI | Low value until commit ships | 2 |
| QuickBooks / Jobber / Housecall Pro source-specific adapters | Generic CSV/XLSX/ZIP mapper covers them; vendor-specific only after we see real exports | 3 |
| Auto-merge above confidence threshold | Manual review only until we measure false-positive rate | 3 |

## Phase 2 (planned, not built)
- `import-api` gains `/batches/:id/commit`, `/batches/:id/rollback`, `/files/process` routes.
- File worker drains `import_file_queue` into final buckets with sha256 dedup.
- Rollback engine consumes `import_rollback_items`; payment rows require dev override.
- Full audit log on every live mutation.

## Phase 3 (planned, not built)
- Vendor-specific schema detectors (JobNimbus ZIP, AccuLynx export, Roofr PDF bundles, QuickBooks IIF/CSV).
- Auto-merge for high-confidence duplicates.
- Migration Report PDF export.

---

## Technical details

```text
Routes added to single function `import-api`:
  POST /batches
  GET  /batches
  GET  /batches/:id
  GET  /batches/:id/status
  POST /batches/:id/upload-url
  POST /batches/:id/validate
  POST /batches/:id/detect-duplicates
  POST /batches/:id/dry-run
  POST /files/:id/detect-schema
  POST /files/:id/parse
  POST /duplicates/:id/decide
```

```text
RLS pattern (all 10 tables):
  master role → ALL
  tenant admin → SELECT/INSERT/UPDATE WHERE tenant_id = current_tenant_id()
  no DELETE from client
  service-role-only INSERT into audit_log + rollback_items
```

```text
Validation severity:
  error   → blocks live import (Phase 2)
  warning → allowed but flagged in dry-run
  info    → cosmetic
```

```text
Duplicate confidence:
  >= 0.95 → "high — recommend merge"   (still manual in Phase 1)
  0.7-0.95 → "review"
  < 0.7   → not surfaced
```

### Acceptance criteria for Phase 1
1. Master user uploads a 50k-row JobNimbus contacts CSV; rows land in `import_staging_records` in chunks without timing out.
2. Validation runs and produces a downloadable error CSV.
3. Duplicate review surfaces real matches against existing `contacts` for the tenant.
4. Dry-run summary returns counts in <5s for a 50k-row batch.
5. Zero writes to `contacts`, `jobs`, `invoices`, or any production table.
6. Function count increases by exactly **1** (461 → 462).
7. All routes auth-gated; all queries explicitly filter `tenant_id`.
8. `docs/import-migration-center.md` exists and documents Phase 2/3 deferred scope.

If this phasing looks right, approve and I'll implement Phase 1.
