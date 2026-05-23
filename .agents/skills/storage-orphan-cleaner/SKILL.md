---
name: storage-orphan-cleaner
description: Scans Supabase Storage, cross-references DB records, and quarantines (never hard-deletes) orphaned, duplicate, misplaced, or improperly-public roofing CRM files (photos, PDFs, signed docs, measurement reports, permits, estimates, AI outputs, mobile uploads). Auto-loads on any request touching storage cleanup, orphan detection, Supabase Storage audits, the `storage-orphan-cleaner` edge function, the `storage_quarantine` / `storage_orphan_scans` tables, duplicate-upload dedupe, public-vs-private bucket policy enforcement, tenant-folder misplacement, or unreferenced mobile/AI file purges.
---

# Storage Orphan Cleaner

Roofing CRM files are **legal/claim evidence**. Never hard-delete. Quarantine first, delete only after retention window expires and a master-role human signs off (or the configured auto-purge window passes with no restore).

## Scope

Scans `storage.objects` across all buckets and cross-references DB tables. Detects:

| Category | Rule |
|---|---|
| `unlinked` | Path not referenced by any of: `photos.storage_path`, `documents.storage_path`, `signed_documents.*`, `measurement_reports.pdf_url`/`model_3d_url`, `permits.*`, `estimates.*`, `ai_measurement_jobs.*`, `inspection_photos.*`, `proposals.pdf_url`, `invoices.pdf_url`. |
| `duplicate` | Same `md5(content)` + same `tenant_id` prefix, keep newest by `created_at`, mark others duplicate. |
| `failed_ai_output` | Under `ai-outputs/` or `measurement-*` buckets where parent `ai_measurement_jobs.result_state` is a hard-fail bucket AND no `geometry_report_json.delivered=true`. |
| `temp_old` | Under `temp/`, `tmp/`, `temp-uploads/`, `drafts/` and `created_at < now() - interval '7 days'`. |
| `unreferenced_mobile` | Under `mobile-uploads/` with no `mobile_upload_sessions` row OR session `status='abandoned'` for >14d. |
| `wrong_tenant_folder` | First path segment is not a valid `tenants.id` UUID, OR uploader's `user_company_access` does not include that tenant. |
| `improperly_public` | In a public bucket but contains signed docs, contracts, PII, financial PDFs, or matches `(signed|contract|invoice|estimate|permit|claim|insurance)`. |

## Hard rules (refuse if violated)

1. **No hard delete in the scanner.** The edge function only moves objects to the `quarantine` bucket and writes a `storage_quarantine` row. A separate, master-only `storage-quarantine-purge` function performs deletes, and only for rows where `quarantined_at < now() - retention_days` AND `restore_requested_at IS NULL` AND `legal_hold = false`.
2. **Two-step move**: copy to `quarantine/{tenant_id}/{original_bucket}/{original_path}` → verify checksum → delete original → insert `storage_quarantine` row. If any step fails, rollback and log.
3. **Never quarantine** anything with `legal_hold=true`, anything referenced by a row with non-null `signed_at`/`accepted_at`/`paid_at`/`claim_number`, or anything under `contracts/`, `signed/`, `legal/`, `insurance-claims/` buckets unless `force_legal_review=true` AND triggered by master role.
4. **Tenant safety**: every scan run is scoped per tenant. Cross-tenant batches forbidden. Cron iterates tenants serially.
5. **Default retention**: 90 days for `unlinked`/`duplicate`/`temp_old`/`unreferenced_mobile`, 180 days for `failed_ai_output`, 365 days for `wrong_tenant_folder` and `improperly_public` (these are usually misconfig, not garbage).
6. **Dry-run by default** for any newly added category or bucket. Promote to live only after one full scan cycle with zero false positives in `storage_orphan_scans.findings`.
7. **Batch limits**: scan ≤ 10000 objects per run per bucket; quarantine ≤ 2000 objects per run. Always paginate `storage.objects` by `created_at` cursor.
8. **Audit row required**: every scan writes one `storage_orphan_scans` row (id, tenant_id, started_at, finished_at, buckets_scanned, findings JSONB summary, quarantined_count, dry_run, triggered_by).
9. **Public→private remediation**: for `improperly_public`, move object to the matching private bucket (not quarantine) and update the referencing DB row's URL column in the same transaction. Only quarantine if no referencing row exists.
10. **Restore path**: `storage_quarantine.restore()` moves object back to original bucket+path, verifies no conflict, clears the row. Master-only.

## Required schema

```sql
create table storage_quarantine (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  original_bucket text not null,
  original_path text not null,
  quarantine_path text not null,
  category text not null check (category in
    ('unlinked','duplicate','failed_ai_output','temp_old',
     'unreferenced_mobile','wrong_tenant_folder','improperly_public')),
  reason jsonb not null,
  size_bytes bigint,
  checksum text,
  quarantined_at timestamptz not null default now(),
  retention_days int not null,
  legal_hold boolean not null default false,
  restore_requested_at timestamptz,
  restored_at timestamptz,
  purged_at timestamptz,
  scan_id uuid references storage_orphan_scans(id)
);

create table storage_orphan_scans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  buckets_scanned text[] not null,
  findings jsonb not null default '{}'::jsonb,
  quarantined_count int not null default 0,
  dry_run boolean not null default true,
  triggered_by text not null
);
```

RLS: master-only SELECT/UPDATE on both. No INSERT from client — only edge function service role.

## Architecture

- `supabase/functions/storage-orphan-cleaner/index.ts` — entrypoint; iterates categories, calls `detectors/*.ts`, dispatches to `quarantine.ts`.
- `supabase/functions/storage-orphan-cleaner/detectors/*.ts` — one file per category. Each exports `detect(ctx): AsyncIterable<Finding>`.
- `supabase/functions/storage-orphan-cleaner/quarantine.ts` — two-step move + audit row.
- `supabase/functions/storage-quarantine-purge/index.ts` — separate function, master-only, deletes expired quarantine rows.
- pg_cron: nightly 04:30 America/Chicago → cleaner; weekly Sunday 05:00 → purge.
- Admin UI at `/admin/storage-orphans` (master-only): per-tenant findings, restore, extend retention, legal-hold toggle, manual scan.

## Required output before code changes

1. Bucket inventory and which DB tables reference each.
2. Per-category detection SQL/query plan and false-positive risks.
3. Migration plan for `storage_quarantine` + `storage_orphan_scans` + `quarantine` bucket.
4. Dry-run sample for at least one category showing what would be quarantined.
5. Cron schedule SQL (uses `insert` tool, NOT migration — contains URL + anon key).
6. Admin UI contract: master-only route, restore/legal-hold/extend actions, RLS verification.

## Refusal triggers

- Any `DELETE FROM storage.objects` or `storage.from(b).remove()` call in the scanner (only the purge function may do this, and only after retention window).
- Quarantining anything with `legal_hold=true`, `signed_at`, `accepted_at`, `paid_at`, or `claim_number` set on the referencing row.
- Cross-tenant batch operations.
- Skipping the `storage_quarantine` audit row.
- Hardcoding bucket allowlists without confirming references in the actual schema.
- Touching `tenants`, `companies`, `users`, `profiles`, `user_company_access`, `roles`.
- Promoting a new category to live without one clean dry-run cycle.
