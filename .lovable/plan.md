## Context

I searched the codebase: there is **no `Lock Material Baseline` button** currently rendered in `src/components/orders/MaterialOrderDetail.tsx`, `PriceLockStatus.tsx`, `ProjectMaterialsTab.tsx`, or anywhere under `src/components/orders/*`. The only lock UI is the read-only `PriceLockStatus` panel that *displays* whether prices were locked at PO creation. So "remove the button" becomes "make sure no such button gets added and keep the lock as an automatic state transition only."

The real work is the three behavioral changes:
1. Auto-lock the material baseline on export OR on supplier send.
2. When a supplier (SRS / ABC / QXO) returns a confirmed order payload with verified line prices, build a vendor invoice from it.
3. Template "Update Costs" pulls a per-item average across the tenant's connected suppliers, falling back to the tenant's uploaded price sheet — never cross-tenant.

User confirmed:
- Pricing scope: **only on next Update Costs click** (no retroactive backfill).
- Supplier-verified invoice lands **as a vendor invoice on the project** (same surface AI invoice processing writes to).
- Multi-tenancy is non-negotiable — tenant_id filtering everywhere.

---

## Part 1 — Material baseline auto-lock

**No new UI button.** Auto-lock happens on two server-side triggers.

### 1a. Lock on Export Material Order
Edge function (existing CSV/PDF export path in `MaterialLineItemsExport.tsx`) writes:
- `purchase_orders.baseline_locked_at = now()`
- `purchase_orders.baseline_lock_reason = 'export'`
- snapshot each `purchase_order_items.unit_price / line_total / quantity` into a new `purchase_order_baseline_snapshots` row (one row per export, immutable).

If `baseline_locked_at` is already set, export still succeeds but does NOT overwrite the lock — it appends a new snapshot row with `lock_reason='re_export'`.

### 1b. Lock on Push to Supplier
In `srs-api/orders/v2/submit`, `supplier-api/abc/orders/submit`, and the QXO equivalent (when wired), once the supplier accepts the submission (status `queued` / `submitted` / `accepted`):
- Set `purchase_orders.baseline_locked_at = now()`, `baseline_lock_reason = 'supplier_submit'`, `baseline_supplier = 'srs'|'abc'|'qxo'`.
- Snapshot to `purchase_order_baseline_snapshots`.

### 1c. Frontend
- Remove any code path that would render a manual lock button (none exists today — guard with a `// no manual lock; auto-locked on export/submit` comment in `MaterialOrderDetail.tsx`).
- `PriceLockStatus` panel reads `baseline_locked_at` + `baseline_lock_reason` directly and shows "Locked on export" / "Locked on submit to SRS" instead of just timestamp.

---

## Part 2 — Supplier-verified vendor invoice

When supplier order status flips to `accepted` AND payload contains line-level confirmed pricing (SRS `orderConfirmation.items[].unitPrice`, ABC `order.lines[].confirmedPrice`, QXO equivalent), the cron poller / webhook handler will:

1. Look up the matching `purchase_order` via supplier order id.
2. Build a `vendor_invoices` row scoped to the same `tenant_id` and `project_id`:
   - `invoice_number` = supplier's confirmation/invoice number
   - `vendor_id` = the supplier vendor row for that tenant
   - `source = 'supplier_order_confirmation'`
   - `purchase_order_id` = link back
   - `total_amount` = sum of confirmed lines + tax + freight
   - `status = 'pending_review'`
3. Build `vendor_invoice_line_items` rows. Each line is matched back to the PO item by `template_item_supplier_mappings.supplier_item_number` (the approved-SKU table from the prior phase). Items the supplier returns that don't match a mapped SKU go in with `match_status='unmatched'` and force the invoice into review.
4. Compute a `price_variance_vs_baseline` per line by joining against `purchase_order_baseline_snapshots`. Significant deltas (>5%) get flagged.

No estimate mutation — vendor invoice is independent.

### Required tenant gates
- Lookup `purchase_order → tenant_id` server-side; never trust the supplier payload's tenant.
- Webhook resolves supplier order id → PO → tenant, then writes with that tenant_id explicitly.

---

## Part 3 — Template "Update Costs" — multi-supplier averaging

### 3a. New tenant-scoped catalog of supplier price points
Reuse `supplier_price_history` (already written by the SRS pricing-history pipeline) and extend it so ABC and QXO write into the same table with `supplier` column. Schema additions:
- `supplier text not null check (supplier in ('srs','abc','qxo','imported'))`
- `tenant_id uuid not null`
- `template_item_id uuid` (nullable — present when refresh originated from a template)
- index `(tenant_id, supplier, template_item_id, checked_at desc)`

### 3b. Imported price sheet
New table `tenant_imported_price_sheets`:
- `tenant_id, supplier_label, sku, description, uom, unit_price, currency, valid_from, valid_until, source_filename`
- RLS: tenant-only. No cross-tenant reads.
- CSV upload UI in template settings (out of scope of this prompt's wiring — DB + RLS only here; UI is a follow-on).

### 3c. Update Costs resolver
On "Update Costs" click in `TemplateDetailsPanel`, frontend calls a new edge function `template-cost-refresh` that, for each template item:

1. Look up `template_item_supplier_mappings` rows for this tenant + item where `mapping_status='approved'`.
2. For each approved mapping, fetch the most recent **successful** price from `supplier_price_history` (status='ok', non-null unit_price, within last 30 days). Stale > 30 days triggers a live pricing call to that supplier's `/price` route, written back to history.
3. Collect the resulting per-supplier prices into an array.
4. If **0 connected-supplier prices** are available, fall back to the tenant's `tenant_imported_price_sheets` row for that template item (matched via mapping or SKU column on template_items). If still nothing → mark item `cost_source='unresolved'`, do not overwrite existing cost.
5. If **1+ supplier prices**: `unit_cost = average(prices)`, `cost_source = 'supplier_avg'`, persist the contributing supplier list + per-supplier prices to `template_items.cost_breakdown` (jsonb) for audit.
6. Recalculate `template_items.line_total` per the existing engine standards memory (never overwrite `selling_price` — only `unit_cost`; selling price recomputes via margin formula).

### 3d. Tenant isolation
- Edge function resolves `tenant_id` from JWT via `_shared/tenant.ts`, never from body.
- Every `supplier_price_history`, `template_item_supplier_mappings`, `tenant_imported_price_sheets`, and `template_items` query carries `.eq('tenant_id', resolvedTenantId)`.
- RLS on all three tables: tenant-only SELECT/INSERT/UPDATE; service_role for edge functions.

### 3e. Scope
- Only runs when the user clicks Update Costs. No bulk backfill, no cron.
- Does NOT touch estimates or active POs.

---

## Technical details

### Migrations
1. `purchase_orders`: add `baseline_locked_at timestamptz`, `baseline_lock_reason text`, `baseline_supplier text`.
2. New `purchase_order_baseline_snapshots` (tenant_id, po_id, lock_reason, snapshot_jsonb, created_at) + GRANT + RLS.
3. `supplier_price_history`: add `supplier`, `template_item_id` columns + index + update CHECK constraint.
4. New `tenant_imported_price_sheets` + GRANT + RLS.
5. `template_items`: add `cost_source text`, `cost_breakdown jsonb`.

### Edge function changes
- `srs-api`: in `/orders/v2/submit` success path → write baseline lock + snapshot. In `/orders/poll` (or webhook) when status flips to `accepted` with confirmed prices → call shared `buildVendorInvoiceFromSupplierOrder()`.
- `supplier-api` (ABC): mirror the same two hooks.
- New `_shared/supplier-order-to-invoice.ts`: pure function that takes (tenant_id, po_id, supplier_payload) → writes vendor_invoices + lines.
- New `template-cost-refresh`: implements Part 3 resolver.

### Frontend
- `MaterialOrderDetail.tsx`: PriceLockStatus shows lock reason + supplier.
- `TemplateDetailsPanel.tsx`: replace existing `onUpdateCosts` to call new `template-cost-refresh` edge function and show per-item supplier source in a small popover.
- `MaterialLineItemsExport.tsx`: on successful export, call lock-on-export RPC.

### Out of scope
- CSV upload UI for `tenant_imported_price_sheets` (table + RLS only).
- QXO wiring (the prior plan still has QXO paused).
- Any retroactive recompute of existing templates.
- Any change to estimate selling-price or commission logic.

---

## Sequence
1. Migration (Part 1a/b columns + 3 new tables/columns).
2. `_shared/supplier-order-to-invoice.ts` shared builder.
3. Hook into `srs-api` submit + poll/webhook; hook into `supplier-api` ABC equivalents.
4. `template-cost-refresh` edge function + wire `TemplateDetailsPanel` button to it.
5. Lock-on-export hook in `MaterialLineItemsExport.tsx`.
6. Update `PriceLockStatus` to show lock reason/supplier.
7. Smoke test: SRS submit → baseline locks → simulate accepted payload → vendor invoice appears under project financials.

Reply "go" and I'll start with the migration.