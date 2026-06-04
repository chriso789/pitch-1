# Blueprint — Supplier Catalog Tenant-Scope Contract

**Status:** Phase 7.7. Docs only. Closes Phase 7.6c deviation #1 by contract.

## 1. `supplier_catalog_items` schema finding

- `supplier_catalog_items` does NOT carry a `tenant_id` column.
- Tenant scope is reached only via `supplier_catalog_items.supplier_catalog_id → supplier_catalogs.id → supplier_catalogs.tenant_id`.
- Phase 7.6c preflight does not perform this join; it falls back to `binding.unit_cost` for ABC and supplier-targeted bindings. This is acceptable for preview only.

## 2. Supplier catalog tenant-join requirement

Live handoff (Phase 8) MUST verify tenant via the explicit join path:

```text
supplier_catalog_items.supplier_catalog_id
  -> supplier_catalogs.id
  -> supplier_catalogs.tenant_id == resolvedTenantId
```

Live-write code MUST:

- Reject any `supplier_catalog_items` target where `supplier_catalog_id` is null or unresolved.
- Reject any target whose `supplier_catalogs.tenant_id` does not equal the caller's `resolvedTenantId`.
- Reject any target whose parent `supplier_catalogs` row is inactive/archived.
- Treat `supplier_catalog_items` as tenant-unsafe in isolation.

## 3. Allowed future target validation logic

Pseudo-contract for the future Phase 8 / Phase 7.8 runtime:

```text
1. Read supplier_catalog_items row by id, tenant-free.
2. Read supplier_catalogs by row.supplier_catalog_id, tenant-free.
3. Assert supplier_catalogs.tenant_id == resolvedTenantId
   else emit SUPPLIER_CATALOG_ITEM_TENANT_MISMATCH.
4. Assert supplier_catalogs is active
   else emit SUPPLIER_CATALOG_ITEM_TARGET_UNVERIFIED.
5. Assert non-zero, non-null cost on item OR explicit binding.unit_cost
   else emit SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED.
6. If supplier_catalog_id is null
   emit SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED.
```

## 4. Binding-level cost fallback

`binding.unit_cost` may stand in for supplier cost ONLY if all are true:

- The binding row is `is_active = true`.
- The binding row's `tenant_id` equals `resolvedTenantId`.
- The binding row's `approval_status` indicates approved (per resolver v2 contract).
- `binding.unit_cost` is non-null AND non-zero.
- The approval object explicitly records that binding-level cost is being used in place of supplier-catalog source pricing (UI surface required).

Without all five, fall through to `SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED`.

## 5. Blocked scenarios

- `supplier_catalog_id` missing → `SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED`.
- `supplier_catalogs.tenant_id` mismatch → `SUPPLIER_CATALOG_ITEM_TENANT_MISMATCH`.
- Parent supplier catalog inactive → `SUPPLIER_CATALOG_ITEM_TARGET_UNVERIFIED`.
- Item or binding cost unverified → `SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED`.
- No `supplier_catalog_items` may be trusted by id alone without the join.
- No Phase 8 live write may rely on `supplier_catalog_items` without a tenant-safe join verification step in the same transaction.

## 6. RLS implications

- `supplier_catalog_items` RLS, if enabled via the `supplier_catalogs` parent, MUST be re-verified under the worker auth context before Phase 8.
- If RLS on `supplier_catalog_items` permits cross-tenant reads, the join-then-assert pattern above is mandatory (and must use the asserted result, never the raw row).
- Service-role reads MUST still apply the explicit join + tenant assertion.

## 7. Phase 8 test requirements

- Live write attempt where `supplier_catalog_items.supplier_catalog_id` is null → block with `SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED`.
- Live write attempt where parent `supplier_catalogs.tenant_id` != caller tenant → block with `SUPPLIER_CATALOG_ITEM_TENANT_MISMATCH`.
- Live write attempt against archived `supplier_catalogs` → block with `SUPPLIER_CATALOG_ITEM_TARGET_UNVERIFIED`.
- Live write attempt with zero supplier item cost and no binding fallback → block with `SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED`.
- Live write attempt using binding fallback without approval-object confirmation → block with `SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED`.
- Idempotent re-run of any blocked scenario does not write partial state.

## 8. Required blocker codes (canonical)

- `SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED`
- `SUPPLIER_CATALOG_ITEM_TENANT_MISMATCH`
- `SUPPLIER_CATALOG_ITEM_TARGET_UNVERIFIED`
- `SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED`
