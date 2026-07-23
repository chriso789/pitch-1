# Material Price Book Versioning + Historical Audit Engine

**Rule:** A material invoice is ALWAYS audited against the supplier price list whose `effective_date` is the greatest date ≤ `invoice_date` for that supplier. Historical audits are frozen — importing a new price list never changes prior invoices.

---

## 1. Database migration (single migration, approval required)

### 1a. `supplier_price_book_versions` (immutable)
- `id uuid pk`
- `tenant_id uuid not null`
- `supplier text not null check in ('abc','srs','qxo','other')`
- `supplier_label text` (free-form for `other`)
- `effective_date date not null`
- `uploaded_at timestamptz default now()`
- `uploaded_by uuid`
- `source_file_url text`
- `source_file_name text`
- `content_hash text not null` — unique per `(tenant_id, supplier, content_hash)` to block dup uploads
- `status text default 'active'` (`active`|`archived`) — archive only hides from picker, never affects historical lookups
- `description text`
- `item_count int default 0`
- Index: `(tenant_id, supplier, effective_date desc)`
- **Immutable:** trigger blocks UPDATE/DELETE on any column except `status` and `description`.

### 1b. `supplier_price_book_items` (immutable)
- `id uuid pk`
- `price_book_version_id uuid fk → supplier_price_book_versions(id) on delete restrict`
- `tenant_id uuid not null`
- `supplier text not null`
- `supplier_item_number text not null`
- `manufacturer text`, `product_family text`, `color text`
- `description text`
- `uom text`
- `unit_cost numeric(12,4) not null`
- `raw_import jsonb`
- Unique `(price_book_version_id, supplier_item_number)`
- Index `(tenant_id, supplier, supplier_item_number)`
- Trigger blocks UPDATE/DELETE.

### 1c. `material_invoice_audits` (audit ledger, append-only for prior runs)
- `id uuid pk`
- `tenant_id uuid`
- `invoice_id uuid`, `invoice_line_id uuid`
- `material_id uuid nullable`
- `supplier text`, `supplier_item_number text`
- `invoice_date date not null`
- `price_book_version_id uuid not null fk`
- `effective_date_used date not null`
- `expected_unit_cost numeric(12,4)`, `invoice_unit_cost numeric(12,4)`
- `quantity numeric(12,4)`
- `variance numeric(12,4)`, `variance_percent numeric(8,4)`
- `match_method text` (`sku`|`manual`|`ai`|`unmatched`)
- `audit_completed_at timestamptz default now()`
- `audited_by uuid`
- `superseded_by uuid nullable fk self` — set when a user explicitly re-audits with a newer book
- Index `(invoice_id)`, `(tenant_id, supplier, invoice_date)`

### 1d. Resolver function (SECURITY DEFINER)
```sql
create function public.resolve_price_book_version(
  _tenant uuid, _supplier text, _invoice_date date
) returns uuid ...
-- returns id of MAX(effective_date) WHERE effective_date <= _invoice_date and status='active'
```

### 1e. GRANTs + RLS
All three tables: tenant-scoped SELECT/INSERT for `authenticated`; UPDATE blocked by trigger except allowed columns; DELETE denied. `service_role` full. `NOTIFY pgrst, 'reload schema'`.

---

## 2. Import pipeline changes

Files: `supabase/functions/import-supplier-price-list/index.ts`, `srs-pricelist-importer`, `srs-pricelist-backfill`, and any ABC/QXO importers.

- Compute `sha256` of normalized item rows → `content_hash`.
- Reject duplicate hash for same supplier+tenant with a clear error.
- Insert ONE `supplier_price_book_versions` row + N `supplier_price_book_items`. Never UPSERT.
- User must supply `effective_date` (defaults to file's stated date; UI required field).
- Remove all code paths that UPDATE existing supplier price list rows.

Legacy tables (`supplier_price_lists`, `supplier_price_list_items`, `supplier_pricebooks`) remain read-only for backfill; new writes go to the versioned tables only. Migration seeds a v1 version per supplier from the newest legacy list, dated `1900-01-01`, so historical invoices always resolve.

---

## 3. Audit engine rewrite

Files: `supabase/functions/audit-material-invoice/index.ts`, `audit-cost-invoice/index.ts`.

Flow:
1. Read `invoice.invoice_date` + `supplier`.
2. Call `resolve_price_book_version(tenant, supplier, invoice_date)` → `version_id`.
3. Match each line by `supplier_item_number` (fallback SKU alias table) against `supplier_price_book_items WHERE price_book_version_id = version_id`.
4. Compute variance, insert `material_invoice_audits` row with the resolved `version_id` + `effective_date_used`.
5. Never UPDATE CRM `materials.unit_cost` from an invoice audit. Cost drift suggestions still route through `benchmark_update_suggestions` (existing).

Re-audit endpoint: default re-uses the stored `price_book_version_id`. Only an explicit `force_latest=true` (requires user confirmation in UI) re-resolves; the new audit row links `superseded_by` to the old one.

---

## 4. UI changes

- `src/pages/MaterialAuditPage.tsx` "Price Agreements" tabs: list `supplier_price_book_versions` per supplier, showing effective date, uploaded at, item count, hash badge. Old rows never disappear.
- Import dialog: require `effective_date`; show hash-collision error.
- Invoice audit view: display `Price Book Used`, `Effective Date`, `Expected` vs `Invoiced`, variance. Add "Re-audit with current price book" button (confirmation modal explains it does not change history — creates a new audit row).

---

## 5. Migration strategy for existing invoices

- Create legacy seed versions dated `1900-01-01` per supplier from newest legacy list (guarantees resolver always returns something).
- Existing rows in `material_invoice_audit_lines` / `material_invoice_audits` (old flat table) are left as-is; new ledger table starts fresh. Old audits are marked `legacy=true` via a view (`material_invoice_audits_all`) so reports still render historical numbers.
- Backfill script (idempotent, batched): re-resolves each already-processed invoice against the seeded version and writes one row per line to the new ledger, then flips a `migrated_at` flag on the old row.

---

## 6. Tests (`tests/database/price-book-versioning.test.ts`)

Timeline test: seed versions Jan 1 / Mar 15 / Jul 1, insert invoices on Jan 15, Feb 20, Mar 20, Apr 1, Jun 28, Jul 2 → assert resolver returns correct version for each. Import a new version dated Aug 1 → re-run assertions and verify none of the prior audit rows change. Attempt UPDATE on a version row → assert trigger blocks it.

---

## 7. Rollout order

1. Migration (approve first).
2. Import pipeline rewrite + seed legacy versions.
3. Audit engine rewrite + backfill.
4. UI (Price Agreements tabs, import dialog, invoice audit view, re-audit confirmation).
5. Tests + docs (`docs/material-price-book-versioning.md`).

Approve and I'll ship the migration first.
