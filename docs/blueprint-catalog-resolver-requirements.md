# Blueprint — Catalog Resolver Requirements

**Status:** Phase 7 contract doc. No code, no DB changes.

Defines what a future catalog + labor-rate resolver must satisfy before Phase 8 live handoff may write priced lines. Companion to [`blueprint-importer-phase-7-live-handoff-approval-contract.md`](./blueprint-importer-phase-7-live-handoff-approval-contract.md).

## 1. Existing catalog / material / labor sources (repo evidence)

Tables present in `public` today:

- `product_catalog` — tenant product catalog.
- `supplier_catalogs`, `supplier_catalog_items` — vendor catalogs.
- `abc_catalog_items` — ABC Supply catalog (matches `estimate_line_items.abc_*` columns).
- `material_item_match_rules` — match-rule storage (already present; not yet wired to the importer).
- `material_invoice_line_items` — invoice-side material rows (out of scope for resolver, but referenced by the financials path).
- `labor_rates` — tenant labor rate storage.
- `estimate_line_items` — has `material_id`, `labor_rate_id`, ABC-specific pricing columns, and unstructured `unit_cost` / `markup_percent` / `markup_amount` / `total_price`.

No deterministic resolver exists that converts a Phase 4 / Phase 6 candidate's `item_key` + `formula_inputs` into a `material_id` / `labor_rate_id` / `abc_item_number` with confidence scoring and tenant scoping.

## 2. Required resolver behavior (live-write gate)

For Phase 8 to attempt a live write at `catalog_mode = catalog_resolved_only`, the resolver MUST:

- Be deterministic for the same `(tenant_id, item_key, formula_inputs)` input.
- Be tenant-scoped: never resolve to a catalog row owned by a different `tenant_id`.
- Return a single resolution with a confidence score, OR an explicit ambiguity result.
- Respect catalog item active/inactive status.
- Never invent items, units, or prices.
- Never auto-create catalog rows.

## 3. Material resolver requirements

- **Source priority (logical, tenant-configurable):** `product_catalog` → tenant supplier catalogs → ABC catalog (where active integration exists).
- **Allowed match keys:** `item_key`, `xactimate_code` (if present on the source), `manufacturer_sku`, `abc_item_number`, normalized item name + unit.
- **Confidence threshold:** Phase 7 default `>= 0.90`. Below threshold → `CATALOG_MATCH_AMBIGUOUS`.
- **User confirmation:** any match with confidence in `[0.75, 0.90)` requires explicit user confirmation in the approval object; below `0.75` → unresolved.
- **Tenant-specific behavior:** tenants with no `product_catalog` rows for a trade fall back to supplier catalogs; if none, candidate is unresolved.
- **Discontinued / inactive catalog items:** treat as not-a-match; emit `CATALOG_ITEM_INACTIVE`.
- **Duplicate matches:** if two catalog rows tie on score within `< 0.02`, emit `CATALOG_MATCH_AMBIGUOUS`.
- **Unresolved items:** stay in preview; never live-write under `catalog_resolved_only`.

## 4. Labor resolver requirements

- **Source:** `labor_rates` scoped by `tenant_id`, trade, and (where applicable) region/location.
- **Match key:** `item_key` / `labor_code` from Phase 4 templates, plus complexity tier when the rate table supports tiers.
- **Required fields for live write:** `labor_rate_id` resolved AND a non-null rate value. If either is missing → emit `LABOR_RATE_MISSING`.
- **No inference:** complexity multipliers MUST come from the template binding, not from the resolver.

## 5. Unresolved catalog behavior

- Stays visible in preview UI with `CATALOG_UNRESOLVED_PREVIEW_ONLY` warning.
- Blocks live write with `CATALOG_UNRESOLVED_LIVE_HANDOFF`.
- Cannot be force-pushed without enabling `custom_line_mode` (currently disabled).

## 6. Ambiguous match behavior

- Resolver returns the top N candidates plus their scores.
- UI surfaces the choices; the user picks one or marks the line as unresolved.
- The chosen `catalog_item_id` is recorded in the candidate row AND in the approval object's per-candidate metadata.
- Re-running preview with the same inputs MUST reproduce the same ambiguity set (deterministic ordering).

## 7. Inactive catalog item behavior

- If the resolver's top match is inactive, do not silently fall through to the next match.
- Emit `CATALOG_ITEM_INACTIVE` and require the user to either pick an active substitute or leave the candidate unresolved.

## 8. Custom (non-catalog) line mode

- For MVP: `custom_line_mode = disabled`.
- Future enablement requires a separate approval cycle and a documented audit policy. While disabled, any candidate that would otherwise need a custom line MUST emit `CUSTOM_LINE_MODE_NOT_APPROVED` and block live write.

## 9. Reserved blocker codes

- `CATALOG_UNRESOLVED_LIVE_HANDOFF`
- `CATALOG_MATCH_AMBIGUOUS`
- `CATALOG_ITEM_INACTIVE`
- `LABOR_RATE_MISSING`
- `CUSTOM_LINE_MODE_NOT_APPROVED`
- `CATALOG_RESOLVER_NOT_IMPLEMENTED`

## 10. Phase 7.5 recommendation

A safe catalog resolver does not exist in the repo today. Phase 7.5 should ship a **catalog resolver schema + contract** (still docs + minimal schema where required) covering:

- Canonical resolver input/output shape (TS + Python parity, JSON schema).
- Confidence scoring function (deterministic, tenant-scoped).
- Tenant priority configuration (which catalog sources, in what order).
- Active/inactive lifecycle on catalog rows (verify columns exist; add if missing).
- Audit trail for every resolution decision attached to the candidate row.
- Test fixtures covering unresolved, ambiguous, inactive, and resolved paths.

Until Phase 7.5 ships those, Phase 8 live handoff cannot proceed under `catalog_resolved_only` and MUST block with `CATALOG_RESOLVER_NOT_IMPLEMENTED`.
