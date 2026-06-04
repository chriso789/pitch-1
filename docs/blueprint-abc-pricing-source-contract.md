# Blueprint — ABC Pricing Source Contract

**Status:** Phase 7.7. Docs only. Closes Phase 7.6c deviation #2 by contract.

## 1. `abc_catalog_items` schema finding

- `abc_catalog_items` carries item identity (item number, description, unit, manufacturer/category metadata).
- `abc_catalog_items` does NOT carry per-tenant price/cost. ABC pricing lives in ABC webhook price-row tables.
- `abc_catalog_items` is tenant-agnostic (global catalog feed).
- Phase 7.6c relies on `binding.unit_cost` for ABC preview cost. Acceptable for preview only.

## 2. Webhook price-row dependency

Live handoff (Phase 8) MUST source ABC cost from a trusted ABC price source. Either:

- A current, tenant-scoped ABC webhook price row that joins by ABC item number and is fresh per the freshness rule below, OR
- An explicit binding-level `unit_cost` confirmed by the user in the approval object.

If neither is available, the candidate MUST block with `ABC_PRICE_SOURCE_REQUIRED`.

### Freshness rule

- ABC price rows older than the per-tenant configured staleness window MUST emit `ABC_PRICE_ROW_STALE` and block live write.
- If no staleness window is configured, default to "must exist for the current ABC pricing period as defined by the webhook ingestion contract."
- If the ABC webhook ingestion is not yet implemented for the tenant or product line, emit `ABC_PRICE_ROW_MISSING`.

### Tenant verification

- ABC price rows MUST be tenant-scoped; cross-tenant reads emit `ABC_PRICE_SOURCE_TENANT_UNVERIFIED`.

## 3. `binding.unit_cost` fallback rule

`binding.unit_cost` may be used in place of an ABC price row ONLY if all are true:

- Binding is `is_active = true`.
- Binding `tenant_id` equals `resolvedTenantId`.
- Binding `approval_status` indicates approved.
- Binding `unit_cost` is non-null AND non-zero.
- The approval object records explicit user confirmation that binding-level cost is being used in place of the ABC price source. Blocker code if missing: `ABC_BINDING_UNIT_COST_REQUIRES_USER_CONFIRMATION`.

## 4. User confirmation requirement

The Phase 8 approval UI MUST surface, per ABC-targeted candidate:

- The ABC item number and description.
- The cost source actually being used (`abc_webhook_price_row` | `binding_unit_cost`).
- For `binding_unit_cost`: the exact cost value, the binding id, and a checkbox / acknowledgement that captures user confirmation into the approval object.

Without this confirmation in the persisted approval object, ABC candidates that depend on the binding fallback MUST block.

## 5. Blocked scenarios

- ABC candidate with neither price row nor binding fallback → `ABC_PRICE_SOURCE_REQUIRED`.
- ABC webhook price row not found for item → `ABC_PRICE_ROW_MISSING`.
- ABC webhook price row past staleness window → `ABC_PRICE_ROW_STALE`.
- ABC webhook price row tenant mismatch → `ABC_PRICE_SOURCE_TENANT_UNVERIFIED`.
- ABC binding fallback used without approval-object confirmation → `ABC_BINDING_UNIT_COST_REQUIRES_USER_CONFIRMATION`.
- Zero-default cost on any ABC candidate is forbidden (`ZERO_DEFAULT_PRICING_UNSAFE` per Phase 7.6c).

## 6. Phase 8 test requirements

- ABC candidate with current price row → live-write allowed (if all other gates pass).
- ABC candidate with stale price row → block with `ABC_PRICE_ROW_STALE`.
- ABC candidate with missing price row and no binding fallback → block with `ABC_PRICE_SOURCE_REQUIRED`.
- ABC candidate with binding fallback + user confirmation → live-write allowed (recorded in approval object metadata).
- ABC candidate with binding fallback + no user confirmation → block with `ABC_BINDING_UNIT_COST_REQUIRES_USER_CONFIRMATION`.
- Cross-tenant ABC price row attempted → block with `ABC_PRICE_SOURCE_TENANT_UNVERIFIED`.
- Idempotent re-run of blocked scenarios writes no partial state.

## 7. Required blocker codes (canonical)

- `ABC_PRICE_SOURCE_REQUIRED`
- `ABC_PRICE_ROW_MISSING`
- `ABC_PRICE_ROW_STALE`
- `ABC_PRICE_SOURCE_TENANT_UNVERIFIED`
- `ABC_BINDING_UNIT_COST_REQUIRES_USER_CONFIRMATION`
