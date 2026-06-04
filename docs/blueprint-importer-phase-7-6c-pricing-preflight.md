# Blueprint Importer v2 — Phase 7.6c: Pricing Preflight (preview-only)

> **Approval boundary**: Phase 7.6c implements **target validation** and
> **pricing/cost readiness evaluation** for resolved preview candidates.
> It does **NOT** enable Push to Estimate, final pricing, or any live writes.

## Scope

- Read `blueprint_estimate_line_candidates`, `blueprint_catalog_bindings`.
- Read `product_catalog`, `supplier_catalog_items`, `abc_catalog_items`,
  `labor_rates` **only** to validate target rows and cost/rate readiness.
- Read `enhanced_estimates` for target context (already loaded by Phase 6).
- Write to `blueprint_estimate_line_candidates` (status/cost/pricing/metadata)
  and `blueprint_review_flags` (granular blockers/warnings).
- Add routes `POST /blueprint-importer/v2/pricing-preflight` and
  `/pricing-preflight/get` inside the existing `document-worker` family.
- Add UI display of preflight readiness, granular blockers, and preview
  extended_cost.

## Non-goals (still blocked)

- Push to Estimate.
- Live `estimate_line_items` / `enhanced_estimates` / `proposal_tier_items` writes.
- Proposal, work order, purchase order, production task, invoice writes.
- Final customer pricing, tax, discount, margin/markup inference.
- Catalog / labor / match-rules mutation.
- Custom non-catalog line approval runtime.
- AI / fuzzy / first-row-wins matching.

## Target validation

For each candidate that Phase 7.6b resolved to an active binding, Phase 7.6c
loads the binding's target row and validates:

| Check | Blocker |
|---|---|
| Target row exists | `CATALOG_TARGET_MISSING` / `LABOR_RATE_MISSING` |
| Target tenant-safe (tenant-scoped tables only) | `CATALOG_TARGET_TENANT_MISMATCH` / `LABOR_RATE_TENANT_MISMATCH` |
| Target active (where `is_active` exists) | `CATALOG_TARGET_INACTIVE` / `LABOR_RATE_INACTIVE` |
| Active status verifiable | warning `TARGET_ACTIVE_STATUS_NOT_VERIFIABLE` |
| Source/target unit compatible (or conversion rule provided) | `UNIT_CONVERSION_REQUIRED` / `LABOR_RATE_UNIT_MISMATCH` / `LABOR_PRODUCTION_RATE_REQUIRED` |
| Target NOT from `material_item_match_rules` | `MATERIAL_ITEM_MATCH_RULES_OUT_OF_SCOPE` |

Allowed target kinds: `product_catalog`, `supplier_catalog_item`,
`abc_catalog_item`, `labor_rate`. Everything else is blocked.

ABC catalog items are tenant-global; their cost lives in webhook-fetched
price rows, so Phase 7.6c treats ABC base cost as **unverified** and requires
`binding.unit_cost` to be set for preview pricing.

## Material pricing preflight

Inputs: candidate `quantity` + `unit`, resolved binding, optional target row.

```
if pricing_mode == "quantity_only":            → QUANTITY_ONLY_LIVE_LINES_UNSAFE
if !target:                                    → CATALOG_TARGET_MISSING
if tenant-mismatch (tenant-scoped):            → CATALOG_TARGET_TENANT_MISMATCH
if active_verifiable && !is_active:            → CATALOG_TARGET_INACTIVE
if unit-mismatch && no conversion rule:        → UNIT_CONVERSION_REQUIRED
if binding.unit_cost == 0 OR target cost == 0: → ZERO_DEFAULT_PRICING_UNSAFE
if no trusted positive cost:                   → CATALOG_RESOLVED_COST_MISSING
                                                  MATERIAL_UNIT_COST_MISSING
otherwise:
   preview.unit_cost     = binding.unit_cost OR target.base_unit_cost
   preview.extended_cost = quantity * preview.unit_cost   (preview only)
   pricing_status        = ready_for_pricing_review
```

Cost source priority:
1. `binding.unit_cost` when present and positive (most trusted).
2. `target.base_unit_cost` only when `binding.cost_source_type == "catalog"`.
3. Otherwise: blocked as missing.

## Labor pricing preflight

```
if !binding.labor_rate_id OR !target row:      → LABOR_RATE_MISSING
if tenant-mismatch:                            → LABOR_RATE_TENANT_MISMATCH
if active_verifiable && !is_active:            → LABOR_RATE_INACTIVE
if pricing_source_type in (unresolved,disabled): → LABOR_PRICING_RULE_MISSING
if unit != "hr"/"hour":
   if conversion_rule.production_rate_per_hour: warn BINDING_UNIT_CONVERSION_APPLIED
   else:                                       → LABOR_PRODUCTION_RATE_REQUIRED
                                                  LABOR_RATE_UNIT_MISMATCH
if base_rate_per_hour == 0:                    → LABOR_RATE_ZERO_UNSAFE
                                                  ZERO_DEFAULT_PRICING_UNSAFE
otherwise:
   hours = quantity (if hr) OR quantity / production_rate_per_hour
   preview.extended_cost = hours * base_rate_per_hour    (preview only)
   pricing_status        = ready_for_pricing_review
```

Phase 7.6c never infers production rate from candidate metadata, never converts
complexity flags into multipliers, and never accepts zero rates as valid.

## Zero-default pricing risk

`estimate_line_items.unit_cost`, `extended_cost`, and `total_price` are
**NOT NULL DEFAULT 0**. A live insert with quantity but no explicit cost
silently produces a zero-priced customer-facing line. Phase 7.6c therefore
unconditionally rejects `pricing_mode = "quantity_only"` and any explicit-zero
cost/rate that isn't whitelisted by the binding.

## Tables read

| Table | Use |
|---|---|
| `blueprint_estimate_handoff_batches` | tenant + pricing_mode |
| `blueprint_estimate_line_candidates` | candidates + resolver metadata |
| `blueprint_catalog_bindings` | binding referenced by resolver result |
| `product_catalog` | tenant_id, is_active, price_per_square |
| `supplier_catalog_items` | active, base_price, uom |
| `abc_catalog_items` | is_active, costing_uom |
| `labor_rates` | tenant_id, is_active, base_rate_per_hour |

## Tables written

| Table | Write |
|---|---|
| `blueprint_estimate_line_candidates` | cost_status, pricing_status, handoff_blockers, status, metadata (pricing_preflight, preview_cost_summary, target_validation). `handoff_allowed` stays false. |
| `blueprint_review_flags` | preflight blockers/warnings, scoped by `metadata.source='pricing_preflight_v2'` for idempotency. |
| `blueprint_estimate_handoff_batches` | metadata stamp + updated_at. No status promotion. |

## Tables intentionally NOT written

- `enhanced_estimates`
- `estimate_line_items`
- `proposal_tier_items`
- proposal / work order / purchase order / production task / invoice tables
- `product_catalog`, `supplier_catalog_items`, `abc_catalog_items`,
  `labor_rates`, `material_item_match_rules`
- `blueprint_estimate_line_provenance`

## Candidate update behavior

`buildPreflightCandidateUpdate` merges into existing metadata; it never
overwrites `source_measurement_ids`, `plan_path_ids`, `source_document_ids`,
`deterministic_handoff_key`, `resolver_v2_result`, `formula_inputs`,
quantity, or unit. `handoff_allowed` is hard-coded `false`. Terminal
candidate statuses (`live_written`, `superseded`, `cancelled`, `failed`)
are preserved.

## Review flag idempotency

Preflight flags are owned by `metadata.source = 'pricing_preflight_v2'`. On
rerun, the route deletes and re-inserts only that owned set per candidate,
so reruns with unchanged inputs produce identical output (modulo timestamps)
and never duplicate flags.

## UI behavior

`src/pages/BlueprintImporterV2.tsx` exposes a **Run pricing preflight** button
inside the Phase 6 panel. After a run, the panel shows:

- Ready / blocked counts.
- Preview-only extended_cost total badge (never customer-facing).
- Granular blocker / warning chips.
- "Push to Estimate" / "Final pricing" / "Approve custom line" remain disabled
  with explanatory tooltips.

## Verification checklist

- [x] No `estimate_line_items` / `enhanced_estimates` / `proposal_tier_items` writes.
- [x] No mutation of `product_catalog`, `supplier_catalog_items`,
      `abc_catalog_items`, `labor_rates`, `material_item_match_rules`.
- [x] No standalone edge functions.
- [x] `handoff_allowed` stays false for every candidate.
- [x] Quantity-only mode is unconditionally blocked.
- [x] Zero-default pricing is blocked.
- [x] Missing unit_cost / labor_rate are blocked.
- [x] Unit mismatch without conversion rule is blocked.
- [x] Tenant-mismatched targets are blocked.
- [x] Tests: 177/177 pass (146 prior + 31 new Phase 7.6c).

## Implementation gaps / honest deviations

- `supplier_catalog_items` is tenant-scoped via `supplier_catalogs.tenant_id`
  join. Phase 7.6c does not perform that join (it sets `tenant_scoped=false`
  for supplier items and falls back to binding-level cost). A follow-up phase
  should add the join when supplier-based bindings become common.
- ABC catalog pricing is sourced from webhook price rows, not from
  `abc_catalog_items`. Phase 7.6c relies on `binding.unit_cost` for ABC
  preview pricing.
- Phase 7.6c does not validate `unit_conversion_rule` shape beyond presence.
  Invalid rule payloads should be hardened in Phase 7.7.

## Phase 8 readiness decision

**Not yet.** Recommended next phase: **Phase 7.7** — final live-handoff
readiness contract (pricing-required policy, provenance bridge writes
contract, approval workflow, push-to-estimate gating). Phase 8 should only
start once Phase 7.7 demonstrates safe, fully-priced, user-approved
candidates with no zero-default risk.
