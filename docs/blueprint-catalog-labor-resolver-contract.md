# Blueprint — Catalog & Labor Resolver Contract

**Status:** Phase 7.5 contract. No runtime resolver implemented.

Companion to [`blueprint-catalog-resolver-requirements.md`](./blueprint-catalog-resolver-requirements.md). This document defines the output shape, validation, and blockers a future deterministic resolver MUST satisfy.

## 1. Source tables inspected

- `public.product_catalog` — tenant product catalog (primary).
- `public.supplier_catalog_items` — tenant supplier catalogs.
- `public.abc_catalog_items` — ABC Supply catalog (only when ABC integration is active for the tenant).
- `public.material_item_match_rules` — explicit match-rule overrides.
- `public.labor_rates` — tenant labor rates.

## 2. Resolver input

```ts
{
  tenant_id, source_candidate_id, trade_id, item_key,
  normalized_item_name, candidate_type: "material" | "labor",
  formula_inputs, template_binding_id,
  // tenant policy:
  catalog_source_priority: ["product_catalog","supplier_catalog_items","abc_catalog_items"],
  match_confidence_floor: 0.90,
  user_confirmation_band: [0.75, 0.90)
}
```

## 3. Output

See JSON schema: `docs/schemas/blueprint-importer/blueprint-catalog-resolver-output.schema.json`
and TS/Python types: `CatalogResolverOutput`.

## 4. Required determinism

- Same `(tenant_id, item_key, formula_inputs)` → same output.
- No AI matching. No fuzzy match unless deterministic.
- No cross-tenant lookup. Ever.
- No automatic custom-line creation.
- No silent substitution.

## 5. Match-status semantics

| match_status         | live-write allowed? | blocker added                    |
|----------------------|---------------------|----------------------------------|
| `resolved` (≥0.90)   | yes                 | none                             |
| `resolved` (<0.90)   | no                  | `CATALOG_MATCH_AMBIGUOUS`        |
| `unresolved`         | no                  | `CATALOG_UNRESOLVED_LIVE_HANDOFF`|
| `ambiguous`          | no                  | `CATALOG_MATCH_AMBIGUOUS`        |
| `inactive_item`      | no                  | `CATALOG_ITEM_INACTIVE`          |
| `missing_labor_rate` | no                  | `LABOR_RATE_MISSING`             |
| `blocked`            | no                  | resolver-provided                |

## 6. Audit / provenance

Every output MUST carry `provenance.attempted_sources`, `provenance.rejected_matches[]`, and `provenance.resolved_at`. The Phase 8 bridge writer persists this verbatim alongside the live `estimate_line_items` row.

## 7. Tests required before runtime resolver

- Deterministic output across runs for the same input.
- Tenant isolation (input from tenant A never resolves catalog row in tenant B).
- Active/inactive lifecycle.
- Ambiguity tie-break at 0.02 confidence delta.
- Missing labor rate path.
- `validateCatalogResolverOutput` rejects every disallowed shape.

## 8. MVP live-handoff rule

- `catalog_mode = catalog_resolved_only` is the only live-write mode for MVP.
- Unresolved materials cannot live-write.
- Labor candidates without `labor_rate_id` cannot live-write when final pricing is required.
- Quantity-only preview remains allowed under Phase 6.

## 9. Reserved blocker codes

`CATALOG_RESOLVER_NOT_IMPLEMENTED`, `CATALOG_UNRESOLVED_LIVE_HANDOFF`, `CATALOG_MATCH_AMBIGUOUS`, `CATALOG_ITEM_INACTIVE`, `LABOR_RATE_MISSING`, `TENANT_CATALOG_MISMATCH`, `CUSTOM_LINE_MODE_NOT_APPROVED`.
