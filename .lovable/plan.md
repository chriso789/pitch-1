# ABC + SRS SKU Mapping Hardening

QXO is paused. Goal: lock down catalog identity for ABC and SRS so pricing runs and order payloads never operate on guessed SKUs.

## Part 1 — Canonical mapping table

New table `template_item_supplier_mappings` (one row per template_item × supplier; never duplicate templates).

Columns:
- `id uuid pk`
- `tenant_id uuid not null` (RLS scoped)
- `template_item_id uuid not null` → `estimate_template_items.id`
- `supplier text not null check (supplier in ('abc','srs','qxo'))`
- `supplier_item_number text` (ABC itemNumber / SRS productNumber — the API SKU)
- `supplier_product_id text` (SRS internal productId; null for ABC)
- `supplier_item_description text`
- `valid_uoms text[] not null default '{}'`
- `default_uom text`
- `branch_scope text[]` (branches where mapping is valid)
- `account_scope text[]`
- `ship_to_scope text[]`
- `availability_status text`
- `mapping_status text not null default 'unmapped' check (in ('unmapped','auto_matched','needs_review','approved','rejected'))`
- `match_confidence numeric`
- `match_reason text`
- `raw_catalog_payload jsonb`
- `last_checked_at timestamptz`
- `approved_by uuid`
- `approved_at timestamptz`
- `created_at`, `updated_at`
- unique `(tenant_id, template_item_id, supplier)`
- indexes on `(tenant_id, supplier, mapping_status)` and `(tenant_id, template_item_id)`

Grants + RLS:
- `GRANT SELECT, INSERT, UPDATE, DELETE ON ... TO authenticated;` + `GRANT ALL ... TO service_role;`
- RLS: SELECT/INSERT/UPDATE/DELETE policies filter `tenant_id = get_user_tenant_id(auth.uid())`.
- `NOTIFY pgrst, 'reload schema';`

## Part 2 — ABC mapping resolver

Route in existing `supplier-api`: `POST /abc/mapping/resolve` and `POST /abc/mapping/approve`.

Resolver behavior:
- Source of truth: ABC Product API (`itemNumber`, `itemDescription`, `uoms`, `branches[]` via `embed=branches`).
- Search by template item name → return ranked candidates with confidence.
- On approve: write `supplier='abc'` row with `itemNumber → supplier_item_number`, full `uoms[] → valid_uoms`, `branches[] → branch_scope`, `mapping_status='approved'`, `approved_by/at` set.
- Sandbox fallback for the demo SKU `02OCTDUMP` only; production env forbids fallback. Gate via `environment` on `abc_connections` + explicit allowlist.
- Order-submission gate (in existing ABC submit route): refuse unless `itemNumber`, `itemDescription`, UOM ∈ valid_uoms, ship-to, branch, and price are all present. Reuse `evaluateAbcLock` shape.

## Part 3 — SRS mapping resolver

Route in existing `srs-api`: `POST /pricing/catalog-search`, `POST /mapping/resolve`, `POST /mapping/approve`.

Behavior:
- Source of truth: `activeBranchProducts` for tenant's default branch.
- Persist BOTH `productId → supplier_product_id` and `productNumber → supplier_item_number`.
- If `productNumber` is null → force `mapping_status='needs_review'`. Never substitute `productId` as `productNumber`.
- `catalog-search`: server-side filter where `productNumber IS NOT NULL`; supports query by productNumber/productName/manufacturer/category; paginated.
- Pricing route (`/pricing/record-history`) updated: only call `/products/v2/price` when an approved mapping exists with non-null `productNumber`. Otherwise write a price-history row with `status='unavailable'`, `price_source='mapping_missing'` or `'mapping_needs_review'`, no API call.

## Part 4 — Mapping Review UI

New panel `SupplierSkuMappingPanel` mounted inside the existing template editor (no new top-level route, no price grid).

Per template item row shows:
- ABC mapping status badge + approved itemNumber + valid UOMs + branch availability + last_checked_at
- SRS mapping status badge + approved productNumber (+ internal productId tooltip) + valid UOMs + branch availability + last_checked_at
- Actions: **Find Match** (opens supplier-scoped catalog search dialog), **Approve Match**, **Reject Match**

All queries explicitly `.eq('tenant_id', useEffectiveTenantId())`. No cross-supplier price comparison.

## Part 5 — Pricing-history gate

Update both ABC and SRS pricing-history helpers in `_shared/supplier-pricing-history.ts`:

- Before issuing any supplier price call, look up `template_item_supplier_mappings` for `(tenant_id, template_item_id, supplier)`.
- If `mapping_status != 'approved'` OR required SKU field is null:
  - Insert price-history row with `status='unavailable'`, `price_source='mapping_missing'` (no mapping row) or `'mapping_needs_review'` (row exists but not approved).
  - Do NOT call supplier API.
- Approved path unchanged.
- Estimate `selling_price` / `line_total` untouched (already enforced).

## Part 6 — Acceptance tests

Deno tests in `supabase/functions/_tests/`:

ABC:
1. Approved ABC mapping → pricing run records `ok`.
2. Invalid UOM not in `valid_uoms` → blocked.
3. Missing ship-to / branch → blocked.
4. Validate-only ABC order payload passes for approved mapping.
5. Production env + non-`02OCTDUMP` SKU → no sandbox fallback.

SRS:
1. `activeBranchProducts` row with non-null `productNumber` → approve → pricing run uses `productNumber` and records `ok`/`unavailable` truthfully.
2. `productId` alone is never sent as `productNumber`.
3. `productNumber=null` row → `mapping_status='needs_review'` and pricing run writes `price_source='mapping_needs_review'` without calling SRS.

Cross-tenant:
1. Tenant A mappings invisible to Tenant B (RLS).
2. Tenant A price history invisible to Tenant B.
3. Body `tenant_id` spoof rejected; server uses JWT-resolved tenant only.
4. Estimate `selling_price` / `line_total` unchanged after mapping + pricing refresh.

## Sequence

1. Migration: `template_item_supplier_mappings` (schema + grants + RLS + NOTIFY).
2. `_shared/supplier-pricing-history.ts` — add mapping lookup gate.
3. `srs-api` routes: `pricing/catalog-search`, `mapping/resolve`, `mapping/approve`; tighten `pricing/record-history`.
4. `supplier-api` routes: `abc/mapping/resolve`, `abc/mapping/approve`; tighten ABC submit gate; sandbox fallback allowlist.
5. `SupplierSkuMappingPanel` + dialog; wire into template editor.
6. Deno acceptance tests; debug page reuse for proof runs.
7. Proof: one ABC mapping (real itemNumber), one SRS mapping (real productNumber) → green pricing run on both. Only then unblock QXO.

## Out of scope

- QXO wiring (paused).
- ABC/SRS/QXO side-by-side comparison grid (explicitly rejected).
- Overwriting estimate costs from pricing runs.
- Order submission for SRS/QXO in this phase.
