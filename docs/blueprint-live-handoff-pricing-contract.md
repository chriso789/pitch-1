# Blueprint — Live Handoff Pricing Contract

**Status:** Phase 7.5. Verification + contract only.

## 1. estimate_line_items NULL-pricing verification

Verified columns on `public.estimate_line_items`:

| column         | nullable | default | impact                                  |
|----------------|----------|---------|-----------------------------------------|
| quantity       | NO       | 1       | safe                                    |
| unit_type      | NO       | 'each'  | safe                                    |
| unit_cost      | **NO**   | 0       | **silent zero on quantity-only insert** |
| extended_cost  | **NO**   | 0       | **silent zero on quantity-only insert** |
| markup_percent | YES      | 0       | safe                                    |
| markup_amount  | YES      | 0       | safe                                    |
| total_price    | **NO**   | 0       | **rolls into tier subtotal as $0**      |

## 2. enhanced_estimates / tier behavior

Tier subtotals are aggregated from `estimate_line_items.total_price`. A zero-priced quantity-only line silently undercounts the customer-facing tier total. Treated as data corruption.

## 3. proposal_tier_items behavior

`proposal_tier_items` requires non-null pricing for displayed customer documents. Not written in this phase.

## 4. Decision

| pricing_mode               | safety_status                          | live write allowed? |
|----------------------------|----------------------------------------|---------------------|
| `quantity_only`            | `blocked_quantity_only_unsafe`         | no                  |
| `ready_for_pricing_review` | `allowed_pricing_required`             | only after resolver + price |
| (other)                    | `deferred_pending_pricing_contract`    | no                  |

## 5. Required for Phase 8

- Resolver provides catalog price OR user-confirmed price for every live-write candidate.
- Helper `validateQuantityOnlyModeAllowed("quantity_only")` returns `["PRICING_REQUIRED_BUT_UNAVAILABLE"]` and Phase 8 MUST honor it.
- Markup/margin/tax/discount are NEVER inferred — they come from the existing estimate template or user input.
- `INVENTED_PRICING_DETECTED` blocks any line whose price did not come from catalog, labor rate, or explicit user confirmation.

## 6. Remaining gaps

- No "explicit zero is intentional" marker exists on `estimate_line_items`. Phase 7.6 should either add one or keep blocking the mode.
- `enhanced_estimates` totals recompute on insert/update — confirm trigger behavior before any Phase 8 write.

## 7. Phase 7.6a addendum — binding gate

Live handoff remains blocked until the candidate has:

- an `active` `blueprint_catalog_bindings` row (see `blueprint-catalog-labor-resolver-v2-contract.md`)
- a deterministic, non-`unresolved`, non-`custom_line_disabled` target
- a safe unit mapping (`source_unit==target_unit` OR a populated `unit_conversion_rule`)
- an approved `pricing_source_type` (`catalog_cost`, `labor_rate`, or `manual_approved`)
- an approved `cost_source_type` (`catalog`, `labor_rate`, or `fixed`)
- non-zero pricing where `estimate_line_items` requires it (it does — `unit_cost`, `extended_cost`, `total_price` are NOT NULL DEFAULT 0)
- no unresolved pricing blockers

Reaffirmed rules:

- Quantity-only live handoff is unsafe because `estimate_line_items` defaults pricing to 0 (silent tier-total corruption).
- No future implementation may rely on those default-0 values as valid pricing.
- No price may be invented.
- No labor rate may be inferred.
- No margin/markup/tax/discount may be inferred.
- `material_item_match_rules` MUST NOT be used as a pricing source until tenant/company scope is reconciled (`TENANT_COMPANY_SCOPE_UNRESOLVED`).

