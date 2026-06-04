# Blueprint — Estimate Line Write Mapping Contract

**Status:** Phase 7.7. Docs only. Defines exact field mapping between Phase 7.6c preflight output and `estimate_line_items` for the future Phase 8 live write.

## 1. Source candidate fields (input)

From `blueprint_estimate_line_candidates` + `metadata.resolver_v2_result` + `metadata.pricing_preflight`:

- `tenant_id`
- `import_session_id`
- `handoff_batch_id`
- `deterministic_handoff_key`
- `accepted_trade_id`
- `source_draft_line_id` and `source_draft_line_type` (`material` | `labor`)
- `quantity` (canonical numeric)
- `source_unit` and resolved `target_unit`
- `formula_key`, `formula_inputs`
- `source_measurement_ids[]` (non-empty)
- `plan_path_ids[]` (non-empty)
- `source_document_ids[]` (non-empty)
- `resolver_v2_result.target` — `product_catalog` | `supplier_catalog_items` | `abc_catalog_items` | `labor_rates` row reference
- `resolver_v2_result.binding` — `blueprint_catalog_bindings` row reference
- `pricing_preflight.unit_cost_source` — `catalog_target` | `binding_unit_cost` | `abc_price_row` | `labor_rate`
- `pricing_preflight.unit_cost` (verified non-zero)
- `pricing_preflight.production_rate_per_hour` and `base_rate_per_hour` (labor only)
- `pricing_preflight.extended_cost` (preview value; must be recomputed at write time)

## 2. Target fields on `estimate_line_items`

Verified columns (per Phase 7.5 hardening):

| column | nullable | default | Phase 8 source |
|---|---|---|---|
| `id` | NO | gen | DB |
| `enhanced_estimate_id` | NO | — | approval `target_enhanced_estimate_id` |
| `tenant_id` | NO | — | `resolvedTenantId` (NEVER from request body) |
| `description` / `item_name` | NO | — | binding `display_name` ?? target row label |
| `quantity` | NO | 1 | candidate `quantity` |
| `unit_type` | NO | 'each' | resolved `target_unit` |
| `material_id` (FK) | YES | — | only if target is `product_catalog` / supplier item; per existing schema |
| `labor_rate_id` (FK) | YES | — | only if target is `labor_rates` |
| `unit_cost` | **NO** | 0 | preflight `unit_cost` — **MUST be non-zero per pricing contract** |
| `extended_cost` | **NO** | 0 | computed at write time: `quantity * unit_cost` (material) or labor formula |
| `markup_percent` | YES | 0 | NEVER inferred; pass-through only if explicitly set by template |
| `markup_amount` | YES | 0 | NEVER inferred; pass-through only if explicitly set by template |
| `total_price` | **NO** | 0 | computed from existing estimate template/flow; NEVER defaulted to 0 by importer |
| `source_plan_path` (planned) | — | — | candidate `plan_path_ids[0]` reference (planned Phase 1 column) |
| `metadata` | YES | `{}` | importer provenance link (see §6) |

## 3. Pricing / cost field mapping

- `unit_cost` source priority (Phase 8):
  1. `pricing_preflight.unit_cost` from a verified catalog/labor target (preferred).
  2. `binding.unit_cost` only if binding is active, tenant-scoped, approved, non-zero, AND user-confirmed in the approval object (per supplier and ABC contracts).
  3. Otherwise block.
- `extended_cost` MUST be recomputed at write time from the live `quantity` and live `unit_cost`. Do NOT trust preview values.
- For labor: `extended_cost = (quantity / production_rate_per_hour) * base_rate_per_hour`, with both values verified non-zero.
- `total_price` MUST be produced by the existing estimate template path (cost → margin/markup applied by estimate flow). If the estimate flow cannot produce a safe `total_price` from a cost-only draft line, Phase 8 blocks (`TIER_AGGREGATION_UNSAFE`).

## 4. Prohibited default-zero behavior

Hard rules:

- `unit_cost = 0` is forbidden.
- `extended_cost = 0` is forbidden.
- `total_price = 0` is forbidden.
- `quantity = 0` is forbidden.
- Inserting a row that relies on a NOT NULL DEFAULT 0 column to produce any of the above is forbidden.

Blocker codes (must be wired): `ZERO_DEFAULT_PRICING_UNSAFE`, `INVENTED_PRICING_DETECTED`, `QUANTITY_INVALID`.

## 5. Material vs labor mapping

- Material candidates (`source_draft_line_type='material'`):
  - Target is `product_catalog` | `supplier_catalog_items` | `abc_catalog_items`.
  - `material_id` populated when target schema supports it.
  - `labor_rate_id` null.
  - Cost = `quantity * unit_cost`.
- Labor candidates (`source_draft_line_type='labor'`):
  - Target is `labor_rates`.
  - `labor_rate_id` populated.
  - `material_id` null.
  - Cost = `(quantity / production_rate_per_hour) * base_rate_per_hour`.
  - `production_rate_per_hour` and `base_rate_per_hour` MUST be non-zero verified values from the resolved labor rate.

## 6. Metadata / provenance bridge linkage

- `estimate_line_items.metadata` MUST include:
  - `blueprint_import_session_id`
  - `blueprint_handoff_batch_id`
  - `blueprint_line_candidate_id`
  - `blueprint_deterministic_handoff_key`
  - `blueprint_resolver_v2_result_ref` (compact)
  - `blueprint_pricing_preflight_ref` (compact)
- A corresponding `blueprint_estimate_line_provenance` row MUST be inserted in the same transaction and reference the new `estimate_line_items.id` per the [provenance contract](./blueprint-provenance-bridge-live-write-contract.md).
- Update / new-version paths MUST also write a bridge row in the same transaction.

## 7. Blocked field scenarios

| scenario | blocker code |
|---|---|
| `unit_cost` cannot be sourced from a verified catalog/labor target or approved binding | `MATERIAL_UNIT_COST_MISSING` / `LABOR_RATE_MISSING` |
| `unit_cost` resolves to 0 | `ZERO_DEFAULT_PRICING_UNSAFE` |
| `extended_cost` would default to 0 | `ZERO_DEFAULT_PRICING_UNSAFE` |
| `total_price` cannot be safely produced by the estimate template flow | `TIER_AGGREGATION_UNSAFE` |
| `quantity` is null, zero, or negative | `QUANTITY_INVALID` |
| `unit_type` mismatch and no `unit_conversion_rule` | `UNIT_CONVERSION_REQUIRED` |
| `material_id` required by schema but target is not `product_catalog` / supplier item | `MATERIAL_ID_TARGET_MISMATCH` |
| `labor_rate_id` required by schema but target is not `labor_rates` | `LABOR_RATE_ID_TARGET_MISMATCH` |
| Markup/margin/tax/discount inference attempted | `FINAL_PRICING_INFERENCE_FORBIDDEN` |
| Missing provenance bridge insert in the live-write transaction | `PROVENANCE_BRIDGE_REQUIRED` |
| Tenant mismatch on any side of the write | `TENANT_RLS_FAILURE` |
| Deterministic key collision in tenant | `DETERMINISTIC_HANDOFF_KEY_COLLISION` |

## 8. Hard invariants (restated)

- No default-0 values may be persisted as valid pricing.
- No markup, margin, tax, or discount may be inferred.
- No write may proceed if any required `estimate_line_items` field cannot be filled safely.
- Cost-only draft lines are permitted ONLY when the existing estimate flow is verified to handle them without corrupting `enhanced_estimates` tier totals (see [`blueprint-live-handoff-pricing-contract.md`](./blueprint-live-handoff-pricing-contract.md) §2 and the readiness matrix gate #22).
