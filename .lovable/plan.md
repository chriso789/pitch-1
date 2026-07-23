# Material Price Book Versioning + Historical Audit Engine (v2 — corrected)

**Canonical rule:** A material invoice is ALWAYS audited against the supplier price book whose `effective_date` is the greatest date ≤ `invoice_date` for that supplier and tenant, breaking ties by highest `revision`. Historical audits are byte-for-byte frozen: importing, archiving, or re-resolving never mutates a prior audit row.

Tenant scoping in this project uses `company_id` on existing material tables; the resolver + new tables follow that convention and route through the existing `get_user_company_ids()` / role helpers. No client-supplied tenant/company id is trusted.

---

## 0. Real schema baseline (verified before writing SQL)

Confirmed via `information_schema`:

- Existing audit tables already form a two-level model — **keep them**:
  - `public.material_invoice_audits` — run-level (per invoice document). Columns include `company_id`, `invoice_document_id`, `supplier_id`, `price_list_id`, `invoice_date`, totals, `audit_status`.
  - `public.material_invoice_audit_lines` — line-level. Columns include `audit_id`, `invoice_line_item_id`, `supplier_id`, `price_list_id`, `price_list_item_id`, `match_type`, `agreed_uom`, `invoice_uom`, `agreed_unit_price`, `charged_unit_price`, `quantity`, `total_difference`.
- Legacy pricing tables: `supplier_price_lists`, `supplier_price_list_items`, `supplier_pricebooks` — remain read-only. New pricing writes go to the new versioned tables and are linked back through a bridge column so old rows and views keep working.
- Existing invoice line source: `material_invoice_line_items` + `material_invoice_documents`.

The plan therefore **does not create** a table named `material_invoice_audits` a second time. It extends the existing pair and adds new versioning tables alongside them.

---

## 1. Database migration (single migration, approval required)

### 1a. `supplier_price_book_versions` — immutable version headers

Columns:
- `id uuid pk default gen_random_uuid()`
- `company_id uuid not null` (tenant column, matches existing tables)
- `supplier_id uuid not null references public.material_suppliers(id) on delete restrict` — **stable supplier identity**; removes the ambiguous free-text `'other'`. Custom suppliers get a real row in `material_suppliers`.
- `effective_date date not null`
- `revision integer not null` — monotonically allocated per `(company_id, supplier_id, effective_date)`; multiple same-date imports are allowed and ordered deterministically.
- `uploaded_at timestamptz not null default now()`
- `uploaded_by uuid`
- `source_file_url text`
- `source_file_name text`
- `source_file_sha256 text` — raw file hash for traceability
- `content_hash text not null` — canonical normalized content hash (see §1d)
- `status text not null default 'active' check (status in ('active','archived'))` — **UI-only flag; resolver ignores it**
- `description text`
- `item_count integer not null default 0` — set server-side inside the import RPC
- `legacy_price_list_id uuid references public.supplier_price_lists(id)` — for the migration bridge only
- `is_legacy_fallback boolean not null default false`

Constraints & indexes:
- `unique (company_id, supplier_id, effective_date, revision)` — atomic revision allocation
- `unique (company_id, supplier_id, content_hash)` — reject exact duplicate imports
- `index (company_id, supplier_id, effective_date desc, revision desc)` — resolver hot path
- Immutability trigger: block `UPDATE` on all columns except `status` and `description`; block `DELETE` unconditionally.

### 1b. `supplier_price_book_items` — immutable line items

Columns:
- `id uuid pk default gen_random_uuid()`
- `price_book_version_id uuid not null references public.supplier_price_book_versions(id) on delete restrict`
- `company_id uuid not null`
- `supplier_id uuid not null`
- `supplier_item_number text not null`
- `manufacturer text`, `product_family text`, `color text`
- `description text`
- `uom text not null`
- `unit_cost numeric(14,4) not null check (unit_cost >= 0)`
- `raw_import jsonb`

Parent consistency (no drift between item and its version):
- Composite FK: `(price_book_version_id, company_id, supplier_id)` → `supplier_price_book_versions(id, company_id, supplier_id)` with a supporting unique index on the parent.
- Trigger additionally verifies `company_id` and `supplier_id` on insert.

Uniqueness & indexes:
- `unique (price_book_version_id, supplier_item_number)`
- `index (company_id, supplier_id, supplier_item_number)`

Immutability trigger blocks `UPDATE`/`DELETE`.

### 1c. Extend existing audit tables (do not recreate)

`alter table public.material_invoice_audits add column`:
- `price_book_version_id uuid references public.supplier_price_book_versions(id)`
- `effective_date_used date`
- `invoice_snapshot_hash text` — hash of the invoice line set at audit time
- `supersedes_audit_id uuid references public.material_invoice_audits(id)` — set on the **new** run; the old run is never updated
- `idempotency_key text` — retries with the same key return the same run
- `is_canonical boolean not null default true` — canonical historical audits vs `false` for explicit "current price comparison"
- `unique (company_id, invoice_document_id, idempotency_key)`

`alter table public.material_invoice_audit_lines add column`:
- `price_book_version_id uuid`
- `price_book_item_id uuid references public.supplier_price_book_items(id)`
- `contract_uom text`, `invoice_uom text`, `uom_conversion_factor numeric(14,6)`
- `expected_unit_cost numeric(14,4)`, `expected_extended_cost numeric(14,4)`
- `invoiced_unit_cost numeric(14,4)`, `invoiced_extended_cost numeric(14,4)`
- `variance_amount numeric(14,4)`, `variance_percent numeric(10,4)` — nullable when `expected_unit_cost = 0` (see §7)
- `uom_review_required boolean not null default false` — set when conversion is unknown; row is flagged for review instead of pretending units match

Immutability: add trigger blocking `UPDATE`/`DELETE` on both audit tables once `audit_status` moves to `final` (short-lived `draft` window inside the audit RPC only).

### 1d. Canonical content hash (documented algorithm)

Applied server-side inside the import RPC:

1. For each item, normalize:
   - `supplier_item_number` → `upper(regexp_replace(x, '[^A-Z0-9]', '', 'g'))`
   - `uom` → `upper(trim(x))`
   - `unit_cost` → cast to `numeric(14,4)`, canonical string with 4 decimals
   - `manufacturer`, `product_family`, `color`, `description` → `trim(collapse-whitespace)` (keep case for description; upper for the first three)
   - `null` → literal string `\N`
2. Serialize each row as tab-joined normalized fields in this fixed column order: `supplier_item_number, uom, unit_cost, manufacturer, product_family, color, description`.
3. Sort rows lexicographically.
4. Prepend header: `sha256(company_id || '|' || supplier_id || '|' || effective_date::text)`.
5. `content_hash = sha256(header || newline || joined-rows)`.
6. `source_file_sha256` stored separately from the raw uploaded bytes.

Consequence: renewing a price book with unchanged prices but a new `effective_date` produces a new `content_hash` and imports successfully. Re-uploading an identical file for the same date collides on `(company_id, supplier_id, content_hash)` and is rejected.

### 1e. Resolver RPC — historical, deterministic

```sql
create or replace function public.resolve_price_book_version(
  _company_id uuid,
  _supplier_id uuid,
  _invoice_date date
) returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select v.id
  from public.supplier_price_book_versions v
  where v.company_id = _company_id
    and v.supplier_id = _supplier_id
    and v.effective_date <= _invoice_date
  order by v.effective_date desc, v.revision desc
  limit 1
$$;

revoke all on function public.resolve_price_book_version(uuid,uuid,date) from public;
grant execute on function public.resolve_price_book_version(uuid,uuid,date) to authenticated, service_role;
```

Wrapper enforces membership: rejects if `_company_id` is not in `public.get_user_company_ids(auth.uid())`. Resolver **does not filter on `status`** — archiving is UI-only.

### 1f. Atomic import RPC

```sql
create or replace function public.import_supplier_price_book(
  _company_id uuid,
  _supplier_id uuid,
  _effective_date date,
  _source_file_url text,
  _source_file_name text,
  _source_file_sha256 text,
  _description text,
  _items jsonb  -- array of normalized item objects
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$ ... $$;
```

Behavior:
- Verifies caller membership + `price_book_import` role helper.
- Computes canonical `content_hash` server-side from `_items` (never trusts the client).
- Allocates `revision = coalesce(max(revision), 0) + 1` for `(company_id, supplier_id, effective_date)` inside a single `serializable` transaction; concurrent same-date imports serialize cleanly.
- Inserts header + all items in the same transaction. Any invalid row (bad `unit_cost`, empty item number, duplicate `supplier_item_number` within the payload) aborts the whole insert.
- Sets `item_count` from the actual inserted rows.
- Returns the new `price_book_version_id`.
- Duplicate `content_hash` raises `unique_violation` and rolls back.

Grants: `execute` to `authenticated`, `service_role`; revoked from `public`. Direct `insert` on the two versioned tables is denied for `authenticated` via RLS — the RPC is the only write path.

### 1g. GRANTs + RLS

For `supplier_price_book_versions`, `supplier_price_book_items`:
```sql
grant select on public.supplier_price_book_versions to authenticated;
grant select on public.supplier_price_book_items    to authenticated;
grant all    on public.supplier_price_book_versions to service_role;
grant all    on public.supplier_price_book_items    to service_role;

alter table public.supplier_price_book_versions enable row level security;
alter table public.supplier_price_book_items    enable row level security;

create policy pbv_select on public.supplier_price_book_versions
  for select to authenticated
  using (company_id = any (public.get_user_company_ids(auth.uid())));

create policy pbi_select on public.supplier_price_book_items
  for select to authenticated
  using (company_id = any (public.get_user_company_ids(auth.uid())));
```

No `insert/update/delete` policies for `authenticated` — writes go exclusively through the `security definer` RPCs, which re-verify membership + role.

`notify pgrst, 'reload schema';` at the end of the migration.

---

## 2. Import pipeline changes

Files: `supabase/functions/import-supplier-price-list/index.ts`, `srs-pricelist-importer`, `srs-pricelist-backfill`, and any ABC/QXO importers.

- All importers call `public.import_supplier_price_book(...)`; no direct table writes.
- Client must supply `effective_date`; UI required field (default = file's stated date).
- Duplicate-hash errors surface as a clear "This exact price list has already been imported for this supplier" message.
- Legacy importers that mutated `supplier_price_lists` rows are switched to append-only via the new RPC. The old tables become read-only for reads/backfill.

---

## 3. Audit engine rewrite

Files: `supabase/functions/audit-material-invoice/index.ts`, `audit-cost-invoice/index.ts`.

Flow:
1. Read `invoice.invoice_date`, `company_id`, `supplier_id`.
2. `version_id = resolve_price_book_version(company_id, supplier_id, invoice_date)`.
3. If `version_id is null` → run still recorded; every line is `match_type='unmatched'` with `discrepancy_type='no_historical_contract'`. Never treat missing pricing as `0`.
4. Match each `material_invoice_line_items` row by `supplier_item_number` (with SKU-alias fallback) against `supplier_price_book_items WHERE price_book_version_id = version_id`.
5. Compute UOM conversion via existing UOM helpers. Unknown conversions → `uom_review_required = true`, `match_type='needs_uom_review'`; no variance persisted.
6. Persist `material_invoice_audits` (run) with `price_book_version_id`, `effective_date_used`, `invoice_snapshot_hash`, `idempotency_key`, `is_canonical=true`, and matching `material_invoice_audit_lines`.
7. Never update `materials.unit_cost` from an invoice audit. Cost-drift routing continues through `benchmark_update_suggestions`.

Re-audit endpoint:
- Only action is **"Re-resolve price book for this invoice date."** Re-runs the resolver against `invoice_date`; if a backdated version was imported after the last audit, the new run picks it up. Never selects a version with `effective_date > invoice_date`.
- Writes a **new** run row; sets `supersedes_audit_id` on the new row to the previous run id. The old run is untouched.
- `idempotency_key` derived from `(invoice_document_id, invoice_snapshot_hash, version_id)` prevents duplicate retries.
- A separate, clearly labeled **"Compare to current pricing (non-canonical)"** action is available; it writes a run with `is_canonical=false` and is excluded from historical variance reports.

---

## 4. UI changes

- `src/pages/MaterialAuditPage.tsx` "Price Agreements" tabs: list `supplier_price_book_versions` per supplier, showing effective date, revision, uploaded_at, item_count, hash badge, and status. Archived versions render greyed-out with an "Archived (UI-only, still used for historical audits)" tooltip. No delete action.
- Import dialog: `effective_date` required; clear hash-collision error copy; shows revision that will be allocated.
- Invoice audit view: display **Price Book Used**, **Revision**, **Effective Date**, per-line **Contract UOM / Invoice UOM / Conversion / Expected unit & extended / Invoiced unit & extended / Variance $ / Variance %** (with `—` when review is required). Buttons:
  - **"Re-resolve price book for this invoice date"** (confirmation modal: "Creates a new audit run. The prior run is preserved unchanged.")
  - **"Compare to current pricing (non-canonical)"** — separate section, marked non-canonical.

---

## 5. Legacy migration strategy

- For every distinct `(company_id, supplier_id)` in `supplier_price_lists` that has a real `effective_date`, migrate each list as its own version row with its real date (revision allocated in the order they were originally imported). Items copied verbatim; `legacy_price_list_id` links back for reporting continuity.
- For any `(company_id, supplier_id)` referenced by historical `material_invoice_documents` that has **no** dated pricing available, insert a single `is_legacy_fallback = true` version dated `1900-01-01` populated from the newest available legacy list. This guarantees the resolver returns something.
- If neither dated nor legacy items exist for a `(company_id, supplier_id)`, the resolver returns `null` and the audit reports `unmatched / no_historical_contract`. Never treat missing pricing as zero.
- Existing rows in `material_invoice_audits` / `material_invoice_audit_lines` remain unchanged; a view `material_invoice_audits_all` unions the pre-versioning and post-versioning rows for reporting.
- Backfill script is idempotent and batched; it re-resolves each already-audited invoice against the seeded version and writes a **new** audit run linked via `supersedes_audit_id`. Old runs stay byte-for-byte identical and are marked in the view as `legacy=true`.

---

## 6. Tests — `tests/database/price-book-versioning.test.ts`

Cases (all required):

1. Exact effective-date boundary: version dated Mar 15 resolves for invoices on Mar 15 and later; earlier invoices resolve to prior version.
2. Future-dated version is ignored for earlier invoices.
3. Archived version still resolves (status is UI-only).
4. Same-date multiple revisions: highest `revision` wins.
5. Backdated import inserted after an audit: does **not** mutate the prior audit row; a re-resolve creates a new run linked via `supersedes_audit_id`.
6. Duplicate `content_hash` import rejected with a clear error.
7. Import RPC rolls back entirely if any single item is invalid.
8. Cross-tenant RLS: user in company A cannot `select`, resolve for, or import into company B.
9. `UPDATE` and `DELETE` on versions/items/finalized audits are blocked by trigger.
10. Import retry with same content is idempotent (hash unique); audit retry with same `idempotency_key` returns the existing run without duplicating.
11. Re-audit creates a new run and sets `supersedes_audit_id`; old run is byte-identical (row hash compared before/after).
12. Legacy fallback: audit against a fallback version returns matched rows; audit with no items at all returns `no_historical_contract` (never zero).
13. UOM conversion: matched conversion computes variance; unsupported conversion sets `uom_review_required=true` and does not compute variance.
14. Variance percent safely handles `expected_unit_cost = 0` (returns `null`, not division-by-zero).
15. Concurrent same-date imports serialize under `serializable` isolation; both succeed with distinct revisions.
16. Legacy reporting view `material_invoice_audits_all` continues to return pre-versioning rows unchanged.

---

## 7. Rollout order

1. Migration (approve first) — creates versioned tables, extends audit tables, installs resolver + import RPC, RLS, immutability triggers, legacy seed rows, and the compatibility view.
2. Verify migration against real schema (`\d+ material_invoice_audits`, `\d+ supplier_price_book_versions`) and run the acceptance-test suite.
3. Import pipeline rewrite (all supplier importers routed through `import_supplier_price_book`).
4. Audit engine rewrite + backfill (re-audit historicals into new runs; old runs untouched).
5. UI (Price Agreements tabs, import dialog, invoice audit view, re-resolve + non-canonical compare).
6. Tests + docs (`docs/material-price-book-versioning.md`).

Approve and I'll ship the migration first, then report the migration file path, the extended functions, and passing test results before proceeding.
