
# ABC Compliance Pricing Architecture — 3-Layer Refactor

Goal: Pitch stops behaving as a supplier comparison engine. Estimates are built from a contractor-controlled historical benchmark. Live supplier pricing (ABC/SRS/QXO) is only retrieved AFTER a supplier is selected for a material order, and is never shown next to another supplier's price. Materials also gain a per-supplier SKU/item-number mapping table (populated by system mapping or from invoices), with NO per-supplier price stored on the material.

## 1. Database changes (single migration)

### 1a. New table: `material_supplier_skus`
Per-material, per-supplier identifier mapping. Prices deliberately NOT stored here.
- `material_id` (fk materials, cascade)
- `tenant_id`
- `supplier` enum: `abc` | `srs` | `qxo` | `other`
- `supplier_item_number` (text, not null)
- `supplier_product_id` (text nullable — e.g. ABC productId)
- `manufacturer`, `product_family`, `color`, `uom` (nullable)
- `mapping_source` enum: `system_catalog_match` | `manual` | `invoice_ai` | `order_confirmation`
- `mapping_confidence` numeric(3,2)
- `verified_by` uuid, `verified_at` timestamptz
- unique(tenant_id, material_id, supplier, supplier_item_number)
- Standard tenant RLS + GRANTs

### 1b. Extend `materials` (template basis cost only — supplier-neutral)
- `template_basis_unit_cost` numeric
- `template_basis_source` text (`manual` | `historical_blend` | `imported` | `initial`)
- `template_basis_last_updated` timestamptz
- `historical_average_cost` numeric
- `historical_purchase_count` int
- Backfill: copy existing `unit_cost` → `template_basis_unit_cost`, source `initial`.

### 1c. New table: `procurement_cost_ledger` (historical confirmed purchases)
- `tenant_id`, `material_id`, `supplier`, `supplier_item_number`, `manufacturer`, `product_family`, `color`, `uom`, `branch`
- `purchase_date`, `confirmed_unit_cost`, `confirmed_quantity`, `extended_cost`
- `supplier_order_id`, `source_confirmation_id`
- Index on (tenant_id, material_id, purchase_date desc)

### 1d. Extend `material_order_lines` (or equivalent supplier order line table)
- `supplier_quoted_unit_cost`, `supplier_quote_checked_at`, `supplier_pricing_run_id`
- `confirmed_order_unit_cost`, `confirmed_order_total`, `confirmed_order_date`
- `cost_variance_amount`, `cost_variance_percent`

### 1e. `benchmark_update_suggestions` table
Manager-approval queue for basis cost updates derived from the ledger.
- `material_id`, `current_basis_cost`, `suggested_basis_cost`, `sample_size`, `weighted_method`, `status` (`pending`|`approved`|`rejected`|`auto_applied`), `reviewed_by`, `reviewed_at`

### 1f. Trigger + function
On insert into `procurement_cost_ledger`, recompute `materials.historical_average_cost` and `historical_purchase_count` (weighted by recency + quantity, last 12 months). Emit a `benchmark_update_suggestion` when |suggested − current| / current exceeds tenant-configured threshold (default 8%).

## 2. Estimate engine refactor

- `src/utils/materialCalculations.ts` and estimate line writers: source `unit_cost` from `template_basis_unit_cost` exclusively. Remove any read paths that pull ABC/SRS live price into estimate line cost.
- `src/components/estimates/**` price columns labeled "Template Basis Cost" / "Estimated Material Cost". Remove any supplier-price badges from estimate builder.
- `src/lib/templates/supplierPricing.ts` stays for procurement-only surfaces; add a guard export `assertProcurementContext()` and call it from consumers to prevent accidental use inside estimate components.

## 3. Materials UI — per-supplier SKU mapping section

Edit Material dialog (screenshot) gains a new section BELOW the current fields:
```
Supplier Item Numbers
┌──────────────────────────────────────────────────────┐
│ Supplier │ Item #      │ UOM │ Source        │ ⋯    │
│ ABC      │ 0133180     │ EA  │ system match  │ edit │
│ SRS      │ 55-14T-PNT  │ EA  │ invoice AI    │ edit │
│ + Add supplier mapping                               │
└──────────────────────────────────────────────────────┘
No prices shown here — pricing is retrieved per order.
```
- New component `src/components/materials/SupplierSkuMappings.tsx`
- Hook `useMaterialSupplierSkus(materialId)` (CRUD against `material_supplier_skus`)
- Invoice AI processor (existing `AI Invoice Processing`) upserts mappings with `mapping_source='invoice_ai'` when a line matches a material.

## 4. Procurement workflow (supplier selected)

Order builder (`src/components/materials/MaterialOrderBuilder` or equivalent):
1. User picks supplier → resolves `supplier_item_number` from `material_supplier_skus`; if missing, prompts to map.
2. Calls ONLY that supplier's price endpoint. Result stored on the order line as `supplier_quoted_unit_cost` + `supplier_pricing_run_id`.
3. Purchase Review panel shows: Template Basis, Supplier Quote, Variance $/%, Gross Margin Impact — for the selected supplier alone.
4. On confirmed order response → write `confirmed_order_unit_cost` and insert `procurement_cost_ledger` row. Trigger updates historical averages.

Explicitly removed: any UI that renders ABC + SRS + QXO prices side-by-side. `SupplierMappingPanel` tabs remain (per-supplier catalog verification), but do not cross-render prices.

## 5. Manager review workflow

New page `src/pages/pricing/BenchmarkReviewPage.tsx` (linked from Price Management):
- Lists pending `benchmark_update_suggestions`
- Approve → updates `materials.template_basis_unit_cost` + stamps `template_basis_source='historical_blend'`
- Reject → dismisses suggestion
- Tenant setting: `benchmark_mode` = `manual` | `review` | `auto` (with threshold)

## 6. Files changed (summary)

**New:** migration; `SupplierSkuMappings.tsx`; `useMaterialSupplierSkus.ts`; `BenchmarkReviewPage.tsx`; `benchmarkEngine.ts`; `procurementLedger.ts`; edge function `record-confirmed-purchase` (called by ABC/SRS/QXO webhook handlers).

**Modified:** `EditMaterialDialog`, `MaterialsList`, estimate line writers, `materialCalculations.ts`, ABC/SRS/QXO webhook handlers (insert ledger row on order confirmation), `SupplierMappingPanel` (remove any cross-supplier price rendering), `PriceManagementDashboard` (adds Benchmark Review link).

**Docs:** `docs/abc-pricing-architecture.md` — the three-layer contract, used as the artifact to hand back to ABC's review team.

## 7. ABC compliance confirmation

After this refactor:
- Customer-facing estimates never read from a supplier price API.
- ABC pricing is only fetched after ABC is chosen as the fulfillment supplier for a specific order.
- No screen renders ABC pricing beside SRS or QXO pricing.
- ABC data is used only for procurement review, PO submission, committed job cost, and internal purchasing analytics.

## Rollout order

1. Migration (approve first — everything else depends on the new columns/tables).
2. Estimate engine cutover to `template_basis_unit_cost` + Materials UI mapping section.
3. Procurement flow rewrite + ledger writes from confirmation handlers.
4. Benchmark suggestion engine + review page.
5. `docs/abc-pricing-architecture.md` and update `.lovable/plan.md`.

Approve and I'll start with the migration.
