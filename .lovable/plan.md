# Vendor Migration Adapter Layer — Phase 1 Plan

Builds on the existing Import & Migration Center (staging-only, master-only). Scope: vendor detection, normalization preview, and migration planning. **Read-only / staging-only — no live commits.**

## Architecture Guard Compliance

The project is near the 500-function cap (currently 461). The spec requests 5 new edge functions, which would push us closer to the cap and violate the `pitch-crm-architecture-guard` skill ("never create one function per feature").

**Decision**: Add adapter routes to the existing `import-api` grouped function, not as new functions. Function folder count does not increase.

Routes added to `import-api`:
- `POST /batches/:id/detect-source-system`
- `POST /batches/:id/source-manifest`
- `POST /batches/:id/preview-normalized`
- `POST /batches/:id/migration-plan`
- `POST /adapters/test`

Frontend calls via `supabase.functions.invoke('import-api', { body: { route: '...', ... } })`.

## Database Migration (one migration)

Tables (all RLS-gated by `master` role + `company_id = current_tenant_id()`):
- `vendor_import_adapters` — adapter registry seeded with 9 rows (jobnimbus, acculynx, roofr, quickbooks, companycam, jobber, housecallpro, generic_csv, generic_zip)
- `import_source_manifests`
- `import_migration_plans`
- `import_vendor_record_links` (unique on company_id + source_system + source_entity_type + source_record_id — idempotency key)
- `import_status_maps`
- `import_user_maps`
- `import_budget_category_maps`
- `import_document_category_maps`

All include indexes per spec. RLS uses `has_role(auth.uid(), 'master')` + tenant scoping. `NOTIFY pgrst, 'reload schema'` at the end.

## Shared Adapter Library

`supabase/functions/_shared/import/adapters/`:
- `types.ts` — `PitchImportEntity` union, `VendorImportAdapter` interface, `ImportFileDescriptor`, `ImportSourceManifest`, `ImportMigrationPlan` types
- `registry.ts` — `getAdapter(sourceSystem)`, `detectBestAdapter(files)`, registers all 9 adapters
- `jobnimbus.ts` — detects `jnid`, `customer_id`, `job_number`, file names `contacts|jobs|activities|estimates|work_orders`
- `acculynx.ts` — detects `lead_id`, `milestone`, `production_status`, AccuLynx-named files
- `roofr.ts` — detects measurement PDFs, `roof_area`, `facets`, `pitch`, `waste_factor`
- `quickbooks.ts` — detects `TxnDate`, `DocNumber`, IIF/QBO-style headers; routes to invoices/payments/budget
- `companycam.ts` — detects project folders, photo EXIF, ZIP with `project_id`/`photo_id`
- `jobber.ts` — detects `client_name`, `visit_schedule`, `quote_status`
- `housecallPro.ts` — detects `job_type`, `scheduled_start`, `invoice_total`
- `genericCsv.ts` — fallback using existing `fieldAliases.ts`; requires manual entity selection
- `genericZip.ts` — fallback ZIP analyzer, filename/address matching

`supabase/functions/_shared/import/transforms.ts` — trim, title case, normalize phone/email/address, parse currency/percentage/date, split/combine name, status/user/category/stage mappers (consume the four new map tables).

Every adapter implements the full `VendorImportAdapter` interface: `detect`, `buildManifest`, `suggestFieldMap`, `normalizeRecord`, `buildMigrationPlan`. Phase 1 adapters return real detection + normalization; full field maps for the dominant entity per vendor (contacts/jobs for CRM vendors, invoices/payments for QBO, photos for CompanyCam). Remaining entities return stubs with `confidence: 0` + warning, to be filled in Phase 1.5.

## Edge Function Routes (in `import-api`)

1. **`detect-source-system`** — scans batch files via every adapter's `detect()`, returns ranked candidates with confidence scores, writes top result to `import_source_manifests`.
2. **`source-manifest`** — runs chosen adapter's `buildManifest`, persists files/folder structure/detected entities/warnings.
3. **`preview-normalized`** — runs `normalizeRecord` on first N rows per entity (chunked, default 50), returns raw+normalized+confidence+warnings side-by-side. **No DB writes to live tables.**
4. **`migration-plan`** — runs `buildMigrationPlan`, computes migration confidence score (detection × required-field coverage × valid-row % × duplicate rate × file-link confidence × mapping completion), persists to `import_migration_plans` with status `draft`.
5. **`adapter-test`** — accepts a small sample payload, runs detect→parse→normalize→validate, returns mapping confidence + warnings. Used by admin to dry-run before huge imports.

Auth on every route: `requireAuth` + `requireMaster` + tenant resolution from JWT (never from body). Audit log on every action via existing `import_audit_log`.

## Frontend Components

`src/components/import/`:
- `SourceSystemDetector.tsx` — triggers detect route, shows top candidate + confidence
- `VendorAdapterSelector.tsx` — dropdown to override detected vendor (reads `vendor_import_adapters`)
- `SourceManifestViewer.tsx` — files/folders tree, detected entities, warnings
- `MigrationPlanPanel.tsx` — recommended order, required/optional mappings, risk flags, confidence band (Safe/Review/Cleanup/DoNotImport)
- `NormalizedPreviewTable.tsx` — raw row | normalized fields | confidence | warnings | duplicate likelihood; accept/change/ignore/transform actions; "Save template" button
- `AdapterConfidenceCard.tsx` — overall score + band + top issues

Wired into existing `src/pages/developer/ImportCenter.tsx` as new tabs: **Detect → Manifest → Plan → Preview**. Existing Upload / Mapping / Validation / Duplicate Review tabs remain.

## Chunking / Resume

- All routes accept `cursor` (continuation token = `{file_id, offset}`) and `chunk_size` (default 500 rows).
- `import_batches.processed_count` updated per chunk.
- Resume = re-call route with last cursor; `import_vendor_record_links` (UNIQUE constraint) prevents duplicate staging.
- No live-table writes in Phase 1, so resume safety is purely within staging.

## Idempotency

`import_vendor_record_links` is the dedup key. When Phase 2 (live commit) ships, the commit step will check this table before inserting and update-instead-of-insert when a link already exists.

## Out of Scope (deferred to Phase 2)

- Live commit of normalized records to production tables (`contacts`, `jobs`, `invoices`, …)
- Auto-creation of vendor record links during commit
- File movement from `import-quarantine` to production buckets
- Rollback engine
- Full field maps for non-dominant entities per vendor (notes, tasks, messages for non-CRM vendors)

These remain documented in `docs/import-migration-center.md` and surface as `TODO: Phase 2` markers in adapter stubs.

## File Inventory

**New files (15):**
- 1 migration SQL
- 10 adapter files (`types.ts`, `registry.ts`, 8 vendor adapters, generic CSV/ZIP — note: spec lists 11 but types.ts + registry.ts are infrastructure, 9 adapters total)
- 1 `transforms.ts`
- 6 React components

**Edited files (3):**
- `supabase/functions/import-api/index.ts` — add 5 routes
- `src/pages/developer/ImportCenter.tsx` — wire new tabs
- `docs/import-migration-center.md` — document adapter layer + Phase 2 scope

**Function folders added: 0.**

## Acceptance (Phase 1)

- JobNimbus / AccuLynx / Roofr / QuickBooks / CompanyCam / Jobber / Housecall Pro exports detected with confidence score.
- Unknown CSV/ZIP routed to generic fallback with manual-entity warning.
- Migration plan generated with confidence band before any commit option appears.
- Normalized preview shows raw↔normalized side-by-side for first 50 rows per entity.
- Re-running detect/manifest on same batch is idempotent.
- All adapter actions write to `import_audit_log`.
- Master-only enforced server-side; non-master gets 403.

## Confirmation needed

1. **OK to consolidate the 5 requested edge functions into `import-api` routes** (per architecture guard, since we're near the function cap)? The spec asks for separate functions, but project rules forbid sprawl. If you require separate functions, I'll flag the guard violation and you'd need to explicitly approve.
2. **Phase 1 stays staging-only** (no live writes, no Phase 2 commit/rollback) — confirmed from prior phasing decision, just re-confirming since this spec mentions "commit" semantics.
