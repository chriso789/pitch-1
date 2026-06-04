# Blueprint Importer v2 — Phase 7.8 Live-Handoff Hardening + Verification

**Status:** shipped — hardening helpers + tests + docs only. No live writes. No new routes. No worker/UI changes. No standalone edge functions. No catalog/labor mutation. Phase 8 remains **blocked**.

---

## 1. Scope

Phase 7.8 implements the verification gaps Phase 7.7 identified, as pure-function helpers + focused unit tests. Each helper centralises one Phase 7.7 contract and produces the evidence the Phase 7.8 readiness evaluator consumes. No helper performs any DB IO or HTTP call. No persistent estimate_line_items / enhanced_estimates / proposal_tier_items / blueprint_estimate_line_provenance rows are created.

## 2. Non-goals

- No Push to Estimate route.
- No production live `estimate_line_items` writes.
- No production `enhanced_estimates` updates.
- No production `proposal_tier_items` writes.
- No proposal / work-order / purchase-order / production-task / invoice writes.
- No catalog / labor mutation.
- No runtime custom-line approval.
- No user-facing final pricing implementation.
- No standalone edge functions, worker changes, or UI changes.
- No OCR, geometry, drywall/framing/MEP changes.

## 3. Phase 7.7 docs re-read

The following were re-read before any code was written:

- `docs/blueprint-importer-phase-7-7-live-handoff-readiness.md`
- `docs/blueprint-live-handoff-readiness-matrix.md`
- `docs/blueprint-supplier-catalog-tenant-scope-contract.md`
- `docs/blueprint-abc-pricing-source-contract.md`
- `docs/blueprint-estimate-line-write-mapping-contract.md`
- `docs/blueprint-importer-phase-7-6c-pricing-preflight.md`
- `docs/blueprint-importer-phase-7-6b-binding-resolver-runtime.md`
- `docs/blueprint-importer-phase-7-6a-catalog-binding-schema.md`
- `docs/blueprint-provenance-bridge-live-write-contract.md`
- `docs/blueprint-existing-line-resolution-policy.md`
- `docs/blueprint-handoff-approval-object-contract.md`

Read-only DB inspection covered: `estimate_line_items`, `enhanced_estimates`, `proposal_tier_items`, `blueprint_estimate_line_provenance`, `blueprint_estimate_handoff_batches`, `blueprint_estimate_line_candidates`, `supplier_catalogs`, `supplier_catalog_items`, `abc_catalog_items`, `product_catalog`, `labor_rates`, plus `information_schema.triggers` and `pg_indexes` on those tables.

## 4. Findings (verification results)

### 4.1 Supplier catalog tenant-join (Gate 5)

Helper: `supabase/functions/_shared/blueprint-importer/phase7_8-supplier-validation.ts` → `validateSupplierCatalogTarget`.

**Hard finding (carried into Phase 8 blocker list):** In production today `supplier_catalogs` has columns `(id, supplier_name, region, last_sync_at, active, created_at)` — **no `tenant_id` column exists**. Until tenant attribution is added (either on `supplier_catalogs` or in a separate tenant-mapping table), the validator will emit `SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED` for every supplier_catalog target, hard-blocking that branch.

Behaviour:

- Missing `supplier_catalogs` row → `SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED` + `SUPPLIER_CATALOG_ITEM_TARGET_UNVERIFIED`.
- `supplier_catalogs.tenant_id` null → `SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED`.
- `supplier_catalogs.tenant_id !== candidate.tenant_id` → `SUPPLIER_CATALOG_ITEM_TENANT_MISMATCH`.
- Item or catalog `active=false` → `SUPPLIER_CATALOG_ITEM_INACTIVE`.
- Missing `binding.unit_cost` AND missing `supplier_catalog_items.base_price` → `SUPPLIER_CATALOG_ITEM_COST_MISSING` + `SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED`.
- Explicit zero cost → `ZERO_DEFAULT_PRICING_UNSAFE` + `SUPPLIER_CATALOG_ITEM_COST_UNVERIFIED`.
- Cost priority: `binding.unit_cost > supplier_catalog_items.base_price`.

Result: **implemented + tested**. No mutation. Verdict: blocked by schema until supplier tenant attribution exists.

### 4.2 ABC price-source (Gate 8)

Helper: `supabase/functions/_shared/blueprint-importer/phase7_8-abc-validation.ts` → `validateAbcPriceSource`.

Behaviour:

- `abc_catalog_items` is the global identifier only; presence alone is insufficient.
- Price source MUST be one of:
  - A single, fresh (≤ `staleness_ms`), tenant-scoped webhook price row → `price_source = "webhook_price_row"`.
  - An explicit positive `binding.unit_cost` with `binding_unit_cost_user_confirmed=true` → `price_source = "binding.unit_cost"`.
- Multiple tenant rows → `ABC_PRICE_ROW_AMBIGUOUS`.
- Only other-tenant rows present → `ABC_PRICE_SOURCE_TENANT_UNVERIFIED`.
- Stale row → `ABC_PRICE_ROW_STALE`.
- Zero price (row or binding) → `ZERO_DEFAULT_PRICING_UNSAFE`.
- Unconfirmed binding fallback → warning `ABC_BINDING_UNIT_COST_REQUIRES_USER_CONFIRMATION` + blocker `ABC_PRICE_SOURCE_REQUIRED`.

Result: **implemented + tested**. No mutation. Verdict: ready for runtime once Phase 8 wires a tenant-scoped webhook price-row store.

### 4.3 Existing-line-at-key policy (Gate 9)

Helper: `supabase/functions/_shared/blueprint-importer/phase7_8-existing-line-policy.ts` → `evaluateExistingLinePolicy`.

Decision matrix:

| Scenario | Outcome | Approval? |
|---|---|---|
| Same key, identical qty + formula, no user edits | `skip_if_identical` | no |
| Live line `user_edited=true` | `block_if_live_line_user_edited` | n/a |
| Quantity changed | `require_user_choice_if_quantity_changed` | yes |
| Formula key or inputs changed | `require_user_choice_if_formula_changed` | yes |
| Live line exists, no own bridge row | `block_missing_provenance` | n/a |
| Live line tenant != candidate tenant | `block_tenant_mismatch` | n/a |
| Bridge row's target ≠ candidate target | `block_target_mismatch` | n/a |
| Different candidate owns same `(tenant, key)` | `block_key_collision` (+ `DETERMINISTIC_HANDOFF_KEY_COLLISION`) | n/a |
| No live line, no collision | `create_new_version_requires_approval` | yes |

Result: **implemented + tested**. No live update is ever performed.

### 4.4 Provenance bridge transaction (Gate 15)

Helper: `supabase/functions/_shared/blueprint-importer/phase7_8-provenance-bridge.ts` → `runProvenanceBridgeTransaction`.

The bridge orchestrator accepts an abstract `TransactionContext` (`insertEstimateLineItem`, `insertProvenanceBridge`) plus a `withTransaction` wrapper. Tests inject fakes that simulate:

- preview-only candidate → `skipped_preview_only` (no inserts attempted).
- both inserts succeed → `committed` + both row IDs.
- bridge insert throws → `rolled_back_bridge`, line ID nulled, reason captured.
- estimate-line insert throws → `rolled_back_estimate_line`, bridge never called.

The DB-level uniqueness for "one bridge row per `(tenant_id, deterministic_handoff_key)`" is already enforced by index `bp_line_prov_unique_key`; Phase 8 must wrap both inserts in a single Postgres transaction (BEGIN/COMMIT/ROLLBACK or `supabase.rpc` SQL function).

Result: **harness implemented + tested**. No production rows created.

### 4.5 Estimate line write-mapping (Gate 16)

Helper: `supabase/functions/_shared/blueprint-importer/phase7_8-write-mapping.ts` → `buildEstimateLineWritePayload`.

Hard rules enforced:

- `unit_cost` must be explicit, finite, > 0 (zero is `ESTIMATE_LINE_DEFAULT_ZERO_UNSAFE`).
- `total_price` must be explicit (`ESTIMATE_LINE_TOTAL_PRICE_MISSING` otherwise).
- `markup_rule_id` required when `markup_required=true` AND `total_price` is not pre-supplied.
- `markup_percent`/`markup_amount` never inferred — passed only when supplied by the pricing contract.
- `material_id`/`labor_rate_id` preserved only when `candidate.target_validated=true`.
- `approval_ready=false` blocks with `PRICING_CONTRACT_REQUIRED`.
- `extended_cost = quantity * unit_cost` (rounded to 4dp); never derived from `total_price`.

Result: **implemented + tested**. The helper produces a payload **only** when every gate passes; otherwise `payload=null`.

### 4.6 enhanced_estimates / proposal tier side-effects (Gate 22)

Helper: `supabase/functions/_shared/blueprint-importer/phase7_8-tier-side-effects.ts` → `getTierSideEffectsReport`.

DB inspection results:

- `information_schema.triggers` returned **0 rows** on `estimate_line_items`, `enhanced_estimates`, `proposal_tier_items`, `blueprint_estimate_line_provenance`.
- `enhanced_estimates` totals (`material_cost`, `material_total`, `labor_cost`, `labor_total`, …) are `NOT NULL` application-computed columns populated by the existing CRM estimate builder. They are **not recomputed at the DB layer** when `estimate_line_items` is mutated.
- `proposal_tier_items` is fully independent of `estimate_line_items` at the DB layer (its own `tier`, `unit_cost`, `final_price`).

Verdict (`TierVerdict`): **`unsafe_without_phase_7_9_contract`**.

Reasoning: while DB-level side effects are absent, application-layer recompute pathways that read `estimate_line_items` into `enhanced_estimates` totals have not been audited. Phase 7.9 must lock:

1. A draft/non-final-line convention so blueprint-imported lines never participate in tier totals until approved.
2. The `proposal_tier_items` creation strategy.
3. A `calculation_metadata` pointer convention to `handoff_batch_id`.
4. The application code paths that recompute `enhanced_estimates` totals.

The readiness evaluator currently **always blocks** on this gate via `ENHANCED_ESTIMATES_TIER_CONTRACT_REQUIRED_PHASE_7_9`.

### 4.7 Final readiness evaluator

Helper: `supabase/functions/_shared/blueprint-importer/phase7_8-readiness-evaluator.ts` → `evaluateBlueprintLiveHandoffReadiness`.

Aggregates: preflight, supplier validator (when applicable), ABC validator (when applicable), existing-line policy, write-mapping, approval object (`signed`, `approved_by`, `approved_at`, `batch_source_draft_hash` matches candidate `source_draft_hash`), and tier side-effects verdict. Returns `{ ready_for_phase_8_candidate, blocked, blockers, warnings, missing_evidence, readiness_matrix_result }`. Does not write or call APIs.

## 5. Tests

`tests/blueprint-importer/phase7_8.test.ts` — **45 tests**, all passing.

Coverage:

- Supplier validator: 7 cases (happy path, missing catalog, tenant mismatch, no tenant column, missing cost, zero cost, inactive, immutability).
- ABC validator: 9 cases (no source, fresh row, stale, ambiguous, other-tenant only, unconfirmed binding fallback, confirmed binding fallback, zero binding cost, version pin).
- Existing-line policy: 10 cases (identical, user-edited, qty change, formula change, missing provenance, tenant mismatch, target mismatch, key collision, new line approval, version pin).
- Write mapping: 7 cases (happy path, zero unit_cost, missing unit_cost, missing total_price, missing markup rule, no margin inference, target-unvalidated id drop, approval not ready).
- Provenance bridge: 4 cases (preview skip, commit, bridge failure rollback, estimate-line failure rollback).
- Tier side-effects: locked verdict assertion.
- Readiness evaluator: 4 cases (preflight missing, approval missing, draft-hash mismatch, always-block on Phase 7.9 tier gate).
- No-live-write safety: source-text check that helpers contain no `createClient(` or `global.fetch(`.

Full blueprint-importer suite: **222/222 passing** (45 new + 177 retained).

## 6. Migrations & schema changes

**None.** No `CREATE TABLE`, `ALTER TABLE`, `CREATE POLICY`, `CREATE FUNCTION`, or `NOTIFY pgrst, 'reload schema'` was issued. Read-only `information_schema` / `pg_indexes` / `pg_triggers` queries only.

A blocking schema defect was surfaced for the supplier branch (no `tenant_id` on `supplier_catalogs`), but per Phase 7.8 rules this is reported in §4.1 above and not migrated in this phase — it belongs to Phase 7.9 or a dedicated supplier-tenant-attribution migration.

## 7. Remaining blockers for Phase 8

1. `supplier_catalogs.tenant_id` (or equivalent tenant-mapping) does not exist — supplier branch always blocks.
2. Tenant-scoped ABC webhook price-row store is not wired into the pricing-preflight runtime path (the contract exists; the runtime store does not).
3. `enhanced_estimates` / tier application-layer recompute behaviour is not contracted → `ENHANCED_ESTIMATES_TIER_CONTRACT_REQUIRED_PHASE_7_9`.
4. No production Phase 8 implementation has wrapped `estimate_line_items` + bridge inserts in a single transaction. The harness is ready; the wiring is not.

## 8. Phase 8 readiness decision

**Phase 7.9 required.**

Specifically:

- Phase 7.9-a — supplier_catalogs tenant attribution migration + RLS.
- Phase 7.9-b — ABC tenant-scoped webhook price-row store wired to preflight & ABC validator.
- Phase 7.9-c — `enhanced_estimates` / proposal-tier recompute contract + draft/non-final line convention.

After Phase 7.9 the readiness evaluator should return `ready_for_phase_8_candidate=true` for at least one happy-path candidate. Only then may Phase 8 begin.

## 9. Verification checklist

- [x] Phase 7.7 docs re-read.
- [x] Supplier tenant-join validator implemented + tested.
- [x] ABC price-source validator implemented + tested.
- [x] Existing-line policy helper implemented + tested.
- [x] Provenance bridge transaction harness implemented + tested with rollback paths.
- [x] Estimate-line write mapping helper implemented + tested.
- [x] `enhanced_estimates` / tier side-effect verification (verdict: `unsafe_without_phase_7_9_contract`).
- [x] Final readiness evaluator implemented + tested.
- [x] No migrations.
- [x] No new routes, no worker changes, no UI changes, no standalone edge functions.
- [x] No persistent `estimate_line_items` / `enhanced_estimates` / `proposal_tier_items` / `blueprint_estimate_line_provenance` writes.
- [x] No catalog / labor mutation.
- [x] Push to Estimate not enabled.
- [x] 222/222 blueprint-importer tests passing.

## 10. Deviations

- §4.1: schema-level blocker (`supplier_catalogs.tenant_id` missing) is documented and surfaced as a hard blocker but **not fixed** in this phase. Fixing it belongs to Phase 7.9. The validator behaves correctly given today's schema — every supplier_catalog target hard-blocks.
