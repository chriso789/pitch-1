# Blueprint — Tenant/Company Catalog Reconciliation

**Status:** Phase 7.6a contract doc. No runtime code, no migration on legacy tables.

## 1. The mismatch

| surface | scope column | source of truth |
|---|---|---|
| Blueprint Importer v2 (`blueprint_*` tables) | `tenant_id` | `public.get_user_tenant_id()` |
| `material_item_match_rules` | `company_id` | populated by invoice/AP workflow |
| `product_catalog`, `labor_rates`, `supplier_catalog_items` | `tenant_id` | populated by tenant admin |
| `abc_catalog_items` | none (global) | ABC Supply catalog feed |

Blueprint candidates carry `tenant_id`. `material_item_match_rules` carries `company_id` and was built for invoice-side resolution (supplier_sku / manufacturer_sku / normalized_invoice_description). The two scopes are **not proven equivalent** in this repo and no mapping table exists today.

## 2. Decision for Phase 7.6a

The blueprint resolver v2 contract (see `blueprint-catalog-labor-resolver-v2-contract.md`) **does NOT use `material_item_match_rules`**. If a future phase wires it in, that work is gated by:

- `TENANT_COMPANY_SCOPE_UNRESOLVED` blocker code emitted by the resolver, OR
- a documented `company_id ↔ tenant_id` mapping table with RLS coverage, OR
- an explicit ALTER adding `tenant_id` to `material_item_match_rules` with backfill, RLS, and an audit migration.

None of those are in scope for Phase 7.6a.

## 3. ABC catalog

`abc_catalog_items` is tenant-agnostic. Bindings that point at it MUST persist the originating `tenant_id` on the binding row (the `blueprint_catalog_bindings.tenant_id` column already does this) and the `target_abc_item_number` on the binding row. The catalog row is never mutated.

## 4. Tenant resolution helper

All `blueprint_catalog_bindings` RLS policies use `public.get_user_tenant_id()`. The frontend MUST use `useEffectiveTenantId()` for every read/write. Cross-tenant binding is impossible by construction (RLS + unique constraint per tenant).

## 5. Default rule (binding pre-write)

Until reconciliation is contract-locked:

- Do not read from `material_item_match_rules` in the blueprint resolver.
- Do not write to `material_item_match_rules` in the blueprint resolver.
- Do not infer `company_id` from `tenant_id` or vice-versa.
- Emit `TENANT_COMPANY_SCOPE_UNRESOLVED` whenever a resolver path would otherwise require the bridge.

## 6. Open follow-ups (NOT Phase 7.6a)

- Decide whether `material_item_match_rules.tenant_id` should be added.
- Decide whether `company_id` and `tenant_id` are 1:1 in this product.
- If 1:N, define a `tenant_company_map` table with RLS.
- Audit existing `company_id`-scoped reads from blueprint code (currently none).
