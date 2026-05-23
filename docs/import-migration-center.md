# Pitch CRM Import & Migration Center

Phase 1 — staging-only. Master role only.

## Architecture

- **Edge function**: single grouped `import-api` (no new function folders added).
- **Storage buckets**: `imports`, `import-quarantine` (private, tenant-scoped paths).
- **Staging tables**: `import_batches`, `import_files`, `import_field_maps`, `import_staging_records`, `import_validation_errors`, `import_duplicate_reviews`, `import_file_queue`, `import_audit_log`, `import_rollback_items`, `import_templates`.

## Vendor Migration Adapter Layer (Phase 1)

Sits on top of the staging system. **All routes added to `import-api`** — no new edge functions, per architecture guard (project is near the 500-function cap).

### New tables

- `vendor_import_adapters` — registry seeded with 9 adapters.
- `import_source_manifests` — per-batch detected source + files + entities.
- `import_migration_plans` — recommended import order, mappings, risks, confidence score (0–100) + band (safe / review / cleanup / do_not_import).
- `import_vendor_record_links` — idempotency: `UNIQUE(tenant_id, source_system, source_entity_type, source_record_id)`.
- `import_status_maps`, `import_user_maps`, `import_budget_category_maps`, `import_document_category_maps` — admin mapping tables.

### Adapters

`supabase/functions/_shared/import/adapters/`:

| Adapter | Detects | Normalizes (Phase 1) |
|---|---|---|
| `jobnimbus` | `jnid`, `customer_id`, `job_number`, `status_name` | contact, job |
| `acculynx` | `lead_id`, `milestone`, `production_status`, `trade` | contact, job |
| `roofr` | measurement/proposal PDFs, `roof_area`, `waste_factor` | estimate |
| `quickbooks` | `TxnDate`, `DocNumber`, `Customer`, `Memo` | invoice, payment, contact |
| `companycam` | project folders, photo EXIF, `project_id`, `photo_id` | image |
| `jobber` | `client_name`, `visit_schedule`, `quote_status` | contact, job, invoice |
| `housecallpro` | `customer_name`, `scheduled_start`, `invoice_total` | contact, job, invoice |
| `generic_csv` | fallback using `fieldAliases.ts` | raw passthrough |
| `generic_zip` | fallback by extension/folder | metadata only |

All implement the `VendorImportAdapter` interface: `detect`, `buildManifest`, `suggestFieldMap`, `normalizeRecord`, `buildMigrationPlan`.

Shared transforms live in `supabase/functions/_shared/import/transforms.ts` (trim, title case, phone/email/address/currency/percentage/date normalization, name split/combine, status/user mapping).

### Edge function routes (added to `import-api`)

- `POST /batches/:id/detect-source-system` — ranks every adapter; persists top match to `import_source_manifests`.
- `POST /batches/:id/source-manifest` — runs chosen adapter's `buildManifest`.
- `POST /batches/:id/preview-normalized` — `{ source_system, entity_type, limit? }`; returns raw + normalized + confidence + warnings (no DB writes to live tables).
- `POST /batches/:id/migration-plan` — `{ source_system }`; persists to `import_migration_plans`.
- `POST /adapters/test` — sample-row dry-run for adapter QA.
- `GET /adapters` — registry list.

All routes require master role server-side; tenant resolved from JWT, never from body.

## Frontend

`src/components/import/`:

- `SourceSystemDetector`, `VendorAdapterSelector`, `SourceManifestViewer`,
  `MigrationPlanPanel`, `NormalizedPreviewTable`, `AdapterConfidenceCard`.

Wired into `src/pages/developer/ImportCenter.tsx`.

## Phase 2 (planned, not built)

- Live commit of normalized records to production tables.
- Auto-population of `import_vendor_record_links` during commit.
- File movement from `import-quarantine` to production buckets.
- Rollback engine.
- Full field maps for non-dominant entities per adapter (notes, tasks, messages, etc.).
- Cron-based resume worker for long imports.

Phase 2 routes will live in `import-api` (or a new `import-worker` if cron required), still respecting the architecture guard.
