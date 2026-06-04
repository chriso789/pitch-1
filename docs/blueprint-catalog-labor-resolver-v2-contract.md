# Blueprint — Catalog & Labor Resolver Contract v2

**Status:** Phase 7.6a contract. Supersedes the resolver hierarchy in `blueprint-catalog-labor-resolver-contract.md` (v1). Runtime resolver is still NOT implemented.

## 1. What changed vs v1

v1 assumed `product_catalog` / `labor_rates` carry deterministic blueprint-aligned keys (`item_key`, `trade_id`, `unit`, `labor_key`). The Phase 7.6 discovery report proved they do not. v2 introduces a first-class binding table (`blueprint_catalog_bindings`) as the deterministic bridge. The resolver matches against bindings, not against catalog rows directly.

## 2. Resolver input

```ts
{
  tenant_id,
  source_candidate_id,
  trade_id,
  source_item_key,
  source_candidate_type,   // "material" | "labor"
  source_unit,
  source_template_key?,
  source_template_version?,
  formula_inputs
}
```

## 3. Resolver hierarchy

### Material candidates

1. **Active `blueprint_catalog_bindings`** matching:
   - `tenant_id`
   - `trade_id`
   - `source_candidate_type='material'`
   - `source_item_key`
   - `source_template_key` / `source_template_version` (when candidate carries them)
   - unit-compatible (`source_unit==target_unit` OR `unit_conversion_rule` defined)
2. **Existing `candidate.catalog_item_id`** ONLY if:
   - tenant-valid
   - active
   - target table is in the allowed enum
   - unit-compatible
   - provenance preserved
3. **Direct catalog lookup** — disabled. Requires a future approved rule with deterministic keys (not in this phase).
4. **No match** → `unresolved`.

### Labor candidates

1. Active `blueprint_catalog_bindings` matching `source_candidate_type='labor'` with non-null `labor_rate_id`.
2. Direct `labor_rates` lookup ONLY if a binding explicitly points at `labor_rate_id`.
3. No match → `unresolved` + `BLUEPRINT_LABOR_RATE_MISSING`.

No AI. No fuzzy. No first-row wins. No cross-tenant lookup.

## 4. Output

See `docs/schemas/blueprint-importer/blueprint-resolver-v2-result.schema.json` and TS exports in `supabase/functions/_shared/blueprint-importer/catalog-bindings.ts` (`BlueprintResolverV2Result`).

## 5. Status → live-write semantics

| status | live-write allowed? | blocker |
|---|---|---|
| `resolved` (active binding, ≥0.90) | yes | none |
| `resolved` (active binding, <0.90) | no | `BLUEPRINT_CATALOG_BINDING_AMBIGUOUS` |
| `unresolved` | no | `BLUEPRINT_CATALOG_BINDING_MISSING` + `CATALOG_UNRESOLVED_LIVE_HANDOFF` |
| `ambiguous` | no | `BLUEPRINT_CATALOG_BINDING_AMBIGUOUS` |
| `inactive_binding` | no | `BLUEPRINT_CATALOG_BINDING_INACTIVE` |
| `inactive_target` | no | `BLUEPRINT_CATALOG_TARGET_INACTIVE` |
| `unit_mismatch` | no | `BLUEPRINT_CATALOG_UNIT_MISMATCH` |
| `tenant_scope_mismatch` | no | `TENANT_COMPANY_SCOPE_UNRESOLVED` |
| `missing_labor_rate` | no | `BLUEPRINT_LABOR_RATE_MISSING` |
| `blocked` | no | resolver-provided |

## 6. Determinism contract

- Same `(tenant_id, trade_id, source_candidate_type, source_item_key, source_template_key, source_unit)` → same resolver result.
- Ambiguity ordering is deterministic (lowest `binding.id` ULID after priority sort).
- No timestamp, randomness, or cache state may influence the result.

## 7. Audit / provenance

`BlueprintResolverV2Result.provenance` MUST include every `attempted_binding_ids` UUID, every `rejected` reason, and `resolved_at`. Phase 8 bridge writer persists this verbatim alongside the live `estimate_line_items` row.

## 8. Custom-line mode

`custom_line_mode = disabled` for MVP. A binding with `target_kind='custom_line_disabled'` is a documented blocker, not a live-write path. Future enablement requires its own approval cycle.

## 9. Reserved blocker / warning codes

Blockers:
- `BLUEPRINT_CATALOG_BINDING_MISSING`
- `BLUEPRINT_CATALOG_BINDING_AMBIGUOUS`
- `BLUEPRINT_CATALOG_BINDING_INACTIVE`
- `BLUEPRINT_CATALOG_TARGET_INACTIVE`
- `BLUEPRINT_CATALOG_UNIT_MISMATCH`
- `BLUEPRINT_LABOR_RATE_MISSING`
- `BLUEPRINT_LABOR_RATE_INACTIVE`
- `TENANT_COMPANY_SCOPE_UNRESOLVED`
- `CATALOG_UNRESOLVED_LIVE_HANDOFF`
- `CUSTOM_LINE_MODE_NOT_APPROVED`

Warnings:
- `BLUEPRINT_CATALOG_BINDING_NEEDS_REVIEW`
- `BLUEPRINT_CATALOG_BINDING_LOW_CONFIDENCE`
- `BLUEPRINT_CATALOG_BINDING_EFFECTIVE_DATE_NEAR_EXPIRY`
- `BLUEPRINT_CATALOG_TARGET_UNIT_REQUIRES_CONVERSION`

## 10. Out of scope for Phase 7.6a

- Runtime resolver implementation.
- Pricing preflight.
- Push to Estimate.
- Any live `estimate_line_items` / `enhanced_estimates` / `proposal_tier_items` write.
- `material_item_match_rules` wiring (see `blueprint-tenant-company-catalog-reconciliation.md`).
- Backfill of `product_catalog` / `labor_rates`.

---

## Phase 7.6b runtime addendum

Phase 7.6b implements the deterministic runtime described above (no fuzzy /
no AI / no first-row-wins). Authoritative module:
`supabase/functions/_shared/blueprint-importer/phase7_6b-resolver.ts`.

Authoritative routes (document-worker, blueprint-importer v2 family):

- `POST /blueprint-importer/v2/resolve-bindings`
- `POST /blueprint-importer/v2/resolve-bindings/get`

The runtime adds the following ADDITIVE warning codes on top of the contract
warnings:

- `BINDING_REQUIRES_USER_CONFIRMATION`
- `BINDING_TARGET_TABLE_NOT_STRONGLY_FK_ENFORCED`
- `BINDING_USES_UNIT_CONVERSION`
- `BINDING_TARGET_COST_UNVERIFIED`
- `PRICING_PREFLIGHT_NOT_ENABLED_PHASE_7_6B`
- `LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6B`

All other contract guarantees are preserved verbatim. See
`docs/blueprint-importer-phase-7-6b-binding-resolver-runtime.md` for the
runtime architecture, candidate-update contract, review-flag idempotency
strategy, and Phase 7.6c readiness decision.
