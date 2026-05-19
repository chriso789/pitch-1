# Multi-Supplier SKU Mapping System

## Goal
Every material/product carries a **per-supplier SKU** (SRS, ABC, QXO, …) on a hidden back-side panel. When a material order pushes to a supplier, the system automatically attaches that supplier's SKU. New SKUs discovered on scraped invoices auto-fill into the same map so coverage grows over time.

## Current State (what already exists)
- `products` (tenant-scoped catalog) — has a legacy `srs_item_code` column
- `vendor_products` — links `product_id` ↔ `vendor_id` with `vendor_sku` (multi-supplier ready, unused in UI)
- `vendors` (SRS, future ABC/QXO)
- `material_invoice_line_items` — scraped invoice rows with `supplier_sku`, `manufacturer_sku`, `normalized_description`
- `material_item_match_rules` — learned mapping rules (SKU/description → catalog item)
- Push-to-Supplier dialog reads `srs_item_code` only

## What's broken
1. UI only knows about `srs_item_code` (one column, one supplier). No place to manage ABC/QXO SKUs.
2. Estimate line items have no link to `products` — SKUs can never be resolved.
3. Invoice scraper saves to `material_invoice_line_items` but never creates `vendor_products` rows, so no learning.

## The Plan

### 1. Data layer — promote `vendor_products` as the single source of truth
- Backfill: copy every `products.srs_item_code` into a `vendor_products` row for the SRS vendor (one-time migration). Keep `srs_item_code` column for backward read compatibility but stop writing to it.
- Add a unique index on `(tenant_id, vendor_id, product_id)` and `(tenant_id, vendor_id, vendor_sku)` so upserts are clean.

### 2. Resolver — one function, all suppliers
New edge function `resolve-supplier-skus`:
- Input: `{ vendor_id, items: [{ product_id?, name, description }] }`
- For each item: try `vendor_products` by `product_id`; fall back to fuzzy match on name/description against `products` + `vendor_products`; final fallback to `material_item_match_rules`.
- Output: each item with `{ vendor_sku, matched_via, confidence }`.

Push-to-Supplier dialog calls this immediately before submission instead of reading `srs_item_code` directly. Future ABC/QXO push buttons reuse the same function with their `vendor_id`.

### 3. UI — back-side SKU panel on every product / material
On the Product / Material edit drawer (existing), add a collapsible **"Supplier SKUs"** section:
- One row per active supplier in the tenant
- Columns: Supplier | Supplier SKU | Vendor part name | Last seen on invoice | Confidence | Edit
- Inline edit writes to `vendor_products` (upsert)
- Rows with `auto_matched=true` show a "Confirm" button to promote to verified

On the **Push to Supplier dialog**, replace the current "no SRS SKUs" warning with:
- A live preview table showing each line + resolved SKU + status badge (matched / unmatched / low-confidence)
- Per-line "Map SKU" link that opens the same SKU panel inline so reps can map missing ones without leaving the dialog
- Submit button is enabled as soon as ≥1 line is mapped (existing relaxed gate stays)

### 4. Auto-learning from invoices
Extend the existing invoice processor (`material-invoice-process`):
- After saving `material_invoice_line_items`, run a matcher: for each line, find the best `products` row by normalized description + UOM + brand.
- If match confidence ≥0.85 and no `vendor_products` row exists for `(product, supplier)`, **upsert one** with `vendor_sku = supplier_sku`, `auto_matched=true`, `confidence`, and `source_invoice_id`.
- Lower-confidence matches go to a `pending_sku_suggestions` queue surfaced in the Product SKU panel as "Suggested from invoice — approve?".

### 5. Same pattern when ABC & QXO go live
No new tables, no new UI — just:
- Insert a `vendors` row for ABC / QXO
- Their invoice processors push into the same `material_invoice_line_items` → same auto-mapper → `vendor_products` fills itself
- Their respective "Push to ABC / Push to QXO" buttons call `resolve-supplier-skus` with their `vendor_id`

## Technical Details

### New / changed files
- `supabase/migrations/*` — backfill + indexes on `vendor_products`, add `pending_sku_suggestions` table, add `auto_matched/confidence/source_invoice_id` columns on `vendor_products`
- `supabase/functions/resolve-supplier-skus/index.ts` — new
- `supabase/functions/material-invoice-process/index.ts` — add auto-mapper step
- `src/components/products/SupplierSkuPanel.tsx` — new reusable component
- `src/components/products/ProductEditDrawer.tsx` — mount the panel
- `src/components/orders/PushToSupplierDialog.tsx` — call resolver, render preview table, inline map action
- `src/hooks/useSupplierSkuResolver.ts` — small hook around the edge function

### Out of scope (later)
- Bulk CSV importer for supplier price books (already partially exists in `supplier_price_lists`)
- Live SRS / ABC / QXO product-search endpoints for manual mapping (additive — drop-in once their APIs are wired)

## Build Order
1. Migration (vendor_products columns + backfill + suggestions table)
2. `resolve-supplier-skus` edge function
3. Push dialog rewire (gives Jessica a real SRS submission immediately for any product that already has `srs_item_code`)
4. `SupplierSkuPanel` + mount on product drawer
5. Invoice auto-mapper
6. ABC / QXO vendor records (just data — drop in when ready)
