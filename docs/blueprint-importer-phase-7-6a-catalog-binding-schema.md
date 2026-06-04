# Blueprint Importer v2 — Phase 7.6a — Catalog Binding Schema + Resolver Contract v2

**Status:** Phase 7.6a accepted scope. Schema + contracts only. Runtime resolver remains NOT implemented.

## 1. Scope

Approved:
- Additive blueprint-specific binding tables (`blueprint_catalog_bindings`, `blueprint_catalog_binding_events`).
- TS + Python contracts.
- JSON schemas + examples.
- Resolver v2 contract doc.
- Pricing contract update.
- Tenant/company reconciliation doc.
- Pure helper tests.

Non-goals:
- Runtime resolver.
- Pricing preflight runtime.
- Push to Estimate.
- Any live estimate / proposal / work order / PO / invoice write.
- Mutation of `product_catalog`, `labor_rates`, `supplier_catalog_items`, `abc_catalog_items`, `material_item_match_rules`.
- Catalog or labor seeding.
- UI changes.
- Document-worker route changes.
- Standalone edge functions.

## 2. Discovery findings (accepted)

See `blueprint-importer-phase-7-6-discovery-report.md`. Summary:
1. `product_catalog` lacks `item_key` / `sku` / `trade_id` / `unit`.
2. `labor_rates` lacks `trade_id` / `labor_key` / blueprint unit mapping.
3. `material_item_match_rules` is invoice-side, `company_id`-scoped.
4. `abc_catalog_items` is tenant-agnostic.
5. Production catalog/labor tables are empty.
6. A resolver shipped now would resolve zero candidates.

Conclusion: introduce a binding layer instead of forcing blueprint keys into catalog tables that were not designed for them.

## 3. Why a runtime resolver was blocked

A runtime resolver against empty, shape-mismatched tables would emit `unresolved` for every candidate and degrade Phase 6 preview signal into noise without producing any Phase 8 readiness evidence. The Phase 7.6 prompt explicitly required STOP-AND-REPORT in this case.

## 4. Binding table design

`blueprint_catalog_bindings` is tenant-scoped, additive, and never references `product_catalog` / `labor_rates` via FK (those tables lack stable blueprint-compatible semantics). Target references are nullable UUIDs validated by the resolver, not by the database.

Key design points:
- `deterministic_binding_key` UNIQUE per tenant.
- `target_kind='unresolved'` and `target_kind='custom_line_disabled'` are first-class blocked states, not silent failures.
- CHECK constraint blocks `windows_doors` as a standalone trade binding.
- RLS uses `public.get_user_tenant_id()`, mirroring the Phase 5.5 pattern.

## 5. Optional event table

`blueprint_catalog_binding_events` was created — repo style already uses `*_events` audit tables. Insert-only by authenticated users in the same tenant, full access by `service_role`.

## 6. Tenant/company reconciliation

See `blueprint-tenant-company-catalog-reconciliation.md`. Resolver v2 does NOT use `material_item_match_rules` until the scope mismatch is contract-locked. Default behavior emits `TENANT_COMPANY_SCOPE_UNRESOLVED`.

## 7. Resolver v2 contract

See `blueprint-catalog-labor-resolver-v2-contract.md`. Bindings are the deterministic bridge. No AI, no fuzzy, no cross-tenant lookup.

## 8. Pricing contract update

See `blueprint-live-handoff-pricing-contract.md` (Phase 7.6a addendum). Live handoff remains blocked unless every candidate has an active binding, deterministic target, safe unit mapping, approved cost source, and non-zero pricing where required.

## 9. Shared contracts

- TS: `supabase/functions/_shared/blueprint-importer/catalog-bindings.ts`
- Python: `worker/app/blueprint_contracts/catalog_bindings.py`

Pure modules. Side-effect-free. Not registered as worker routes.

## 10. JSON schemas

- `docs/schemas/blueprint-importer/blueprint-catalog-binding.schema.json`
- `docs/schemas/blueprint-importer/blueprint-catalog-binding-event.schema.json`
- `docs/schemas/blueprint-importer/blueprint-resolver-v2-result.schema.json`

## 11. Examples

`docs/examples/blueprint-importer/catalog-bindings/*.example.json` (12 files). Each example is marked as a contract example, not live data, not pushed to estimate, not a catalog seed.

## 12. Migration

Single migration creating both tables with explicit GRANTs, RLS enabled, tenant-scoped policy, indexes on tenant/trade/item_key/target/status/dkey, deterministic-key uniqueness, and `updated_at` trigger.

## 13. Tests

`tests/blueprint-importer/phase7_6a.test.ts` covers:
- Deterministic binding key stability + sensitivity to target/source/unit changes.
- Shape, tenant-scope, trade, unit, and active-for-resolver validators.
- `windows_doors` blocked as standalone binding.
- Future-supported trade blocked from active binding.
- Resolver candidate assertion blockers.
- TS/Python enum parity.
- JSON schema validation of every example file.

## 14. Remaining blockers (Phase 8 still blocked)

- Runtime resolver.
- Pricing preflight.
- Push to Estimate.
- Live estimate writes.
- Catalog/labor table mutation.
- UI for managing bindings.
- Document-worker routes for binding lifecycle.
- Phase 8 live handoff.

## 15. Phase 7.6b readiness

Phase 7.6b (deterministic resolver runtime) is unblocked at the contract level. Before runtime, Phase 7.6a-fix would be required only if the schema or contracts fail review.

## 16. Verification checklist

- [x] Phase 7.6 discovery re-read.
- [x] Catalog/labor model re-inspected (information_schema, row counts via Supabase tools).
- [x] Tenant/company reconciliation documented.
- [x] Migration created and applied.
- [x] `blueprint_catalog_bindings` + `blueprint_catalog_binding_events` created.
- [x] Existing catalog/labor tables NOT altered.
- [x] Existing catalog/labor rows NOT mutated.
- [x] RLS enabled with tenant-scoped policy.
- [x] TS + Python contracts created.
- [x] JSON schemas + examples created.
- [x] Resolver v2 contract doc created.
- [x] Pricing contract updated.
- [x] Pure helper tests added.
- [x] No runtime resolver / no pricing preflight / no UI / no document-worker / no edge function.
- [x] Push to Estimate remains disabled.
- [x] Phase 8 remains blocked.
