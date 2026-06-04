# Blueprint Importer v2 — Phase 7.5: Schema Hardening + Resolver/Pricing/Approval Contracts

**Status:** Implemented. Contracts + minimal safety migrations only.
**Out of scope:** Push to Estimate, live `estimate_line_items` writes, runtime resolver, UI changes, new worker/edge routes.

This phase removes the remaining structural ambiguity surfaced by Phase 7. It does not enable any live CRM estimate write path. Phase 8 remains blocked.

## 1. Scope

Allowed in this phase:

- Minimal DB migrations for safety hardening.
- Shared TS/Python contract + helper updates.
- JSON schema + example additions.
- Pure helper/schema tests.
- Read-only inspection of existing estimate/proposal/catalog/labor behavior.

Explicitly NOT done:

- No Push to Estimate.
- No live `estimate_line_items` inserts/updates.
- No `enhanced_estimates` row mutations (only schema CHECK constraint added).
- No `proposal_tier_items` writes.
- No proposal / work order / purchase order writes.
- No document-worker route changes.
- No UI changes.
- No worker behavior changes.
- No catalog resolver runtime.
- No final pricing implementation.
- No custom-line approval runtime.

## 2. `enhanced_estimates.status` hardening

Inspection of production:

| status  | count |
|---------|-------|
| draft   | 122   |
| sent    | 2     |
| signed  | 6     |

No unknown values found.

Migration added (additive, no row mutation):

```sql
ALTER TABLE public.enhanced_estimates
  ADD CONSTRAINT enhanced_estimates_status_check
  CHECK (status IN ('draft', 'sent', 'signed'));
```

Live handoff behavior (codified in `validateTargetStatusForLiveWrite`):

- `draft` → live write allowed only after every other gate passes.
- `sent` → live write blocked (`TARGET_ESTIMATE_SENT`).
- `signed` → live write blocked (`TARGET_ESTIMATE_APPROVED`).
- Any unknown value → impossible after constraint; helper still emits `TARGET_ESTIMATE_STATUS_UNKNOWN` defensively.

Rollback: `ALTER TABLE public.enhanced_estimates DROP CONSTRAINT enhanced_estimates_status_check;`

## 3. `estimate_line_items` NULL-pricing verification

Inspected columns:

| column         | nullable | default |
|----------------|----------|---------|
| quantity       | NO       | 1       |
| unit_type      | NO       | 'each'  |
| unit_cost      | **NO**   | 0       |
| extended_cost  | **NO**   | 0       |
| markup_percent | YES      | 0       |
| markup_amount  | YES      | 0       |
| total_price    | **NO**   | 0       |

**Decision: outcome B — quantity-only live lines are UNSAFE.**

Reason: a quantity-only insert would silently set `unit_cost=0`, `extended_cost=0`, `total_price=0`. `enhanced_estimates` totals would not error, but they would be **wrong by omission** (zero-priced lines roll into the tier subtotal as $0). That corrupts customer-facing totals.

Resulting helper:

```ts
decideQuantityOnlySafety("quantity_only")          // "blocked_quantity_only_unsafe"
decideQuantityOnlySafety("ready_for_pricing_review") // "allowed_pricing_required"
```

New / reaffirmed blockers:

- `PRICING_REQUIRED_BUT_UNAVAILABLE` (existing) — emitted by `validateQuantityOnlyModeAllowed` for `quantity_only`.
- `QUANTITY_ONLY_LIVE_LINES_UNSAFE` (documented; mirrors the safety decision).

Until Phase 7.6 pricing hardening (resolver wired, NULL-tolerant column changes, or explicit "zero is intentional" marker), live writes from Phase 8 cannot use `pricing_mode = "quantity_only"`.

## 4. Approval-object storage decision

Approach: **structured columns on `blueprint_estimate_handoff_batches` + JSON payload**.

Migration added (additive, nullable, no row mutation):

```sql
ALTER TABLE public.blueprint_estimate_handoff_batches
  ADD COLUMN IF NOT EXISTS approval_object jsonb,
  ADD COLUMN IF NOT EXISTS approval_statement_version text,
  ADD COLUMN IF NOT EXISTS deterministic_approval_hash text,
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.blueprint_estimate_handoff_batches
  ADD CONSTRAINT blueprint_estimate_handoff_batches_approval_status_check
  CHECK (approval_status IS NULL OR approval_status IN (
    'approval_not_started','approval_in_review','approval_ready',
    'approved_for_live_handoff','approval_revoked','approval_superseded','approval_failed'
  ));
```

DB enforces only the enum on `approval_status`. **Approval object shape, hash, and "ready for live handoff" semantics are enforced by `validateApprovalObjectShape` + `validateApprovalHash` in shared contracts.** DB gap documented honestly — no runtime sets `approved_for_live_handoff` in Phase 7.5.

Approval-object schema: `docs/schemas/blueprint-importer/blueprint-handoff-approval-object.schema.json`. Includes every required field listed in the Phase 7 approval-gate contract.

## 5. `source_draft_hash` in deterministic batch key

- TS: `DeterministicBatchKeyInputs.source_draft_hash` is now **required** (`string | null`, not optional). `createDeterministicBatchKey` continues to canonicalize `null` → `"null"`.
- Python: `create_deterministic_batch_key` already accepted `source_draft_hash`; parity confirmed.
- Phase 6 call site (`phase6-preview.ts` line ~431) already passes `inputs.source_draft_hash ?? null`. No route behavior changed; signature only became stricter.

Consequence (documented): when `source_draft_hash` changes between preview and approval, the recomputed `deterministic_batch_key` no longer matches; old preview batches become superseded. Phase 8 must check and emit `APPROVAL_SOURCE_DRAFT_STALE` / `PREVIEW_BATCH_STALE`.

## 6. Catalog / labor resolver contract

See `docs/blueprint-catalog-labor-resolver-contract.md`. Phase 7.5 ships:

- `CatalogResolverOutput` TS interface + Python dataclass.
- JSON schema `blueprint-catalog-resolver-output.schema.json`.
- `validateCatalogResolverOutput` helper that injects blockers based on `match_status` and `match_confidence < 0.9`.

No runtime resolver is implemented. Until it is, Phase 8 live handoff blocks with `CATALOG_RESOLVER_NOT_IMPLEMENTED`.

## 7. Pricing contract

See `docs/blueprint-live-handoff-pricing-contract.md`. Verified `estimate_line_items` schema and codified `decideQuantityOnlySafety`. Live write of quantity-only lines is blocked.

## 8. Handoff / provenance schema diff

Live columns confirmed match Phase 5.5 + Phase 7 logical contracts for:

- `blueprint_estimate_handoff_batches` (now extended with approval columns above).
- `blueprint_estimate_line_candidates`.
- `blueprint_estimate_line_provenance` (logical bridge fields present; `live_estimate_line_item_id` remains nullable per contract).

No mismatches block Phase 8 safety beyond items already listed.

## 9. Shared contract updates

- `supabase/functions/_shared/blueprint-importer/crm-handoff.ts`
  - `source_draft_hash` required in `DeterministicBatchKeyInputs`.
  - New: `ApprovalObject`, `ApprovalStatus`, `ApprovalBlockerCode`, `ApprovalWarningCode`, `DeterministicApprovalHashInputs`, `createDeterministicApprovalHash`, `validateApprovalObjectShape`, `validateApprovalHash`, `EnhancedEstimateStatus`, `validateTargetStatusForLiveWrite`, `validateSourceDraftHashFresh`, `QuantityOnlySafetyStatus`, `decideQuantityOnlySafety`, `validateQuantityOnlyModeAllowed`, `CatalogResolverOutput`, `CatalogResolverMatchStatus`, `CatalogResolverBlockerCode`, `validateCatalogResolverOutput`.
- `worker/app/blueprint_contracts/crm_handoff.py`
  - Parity additions for all of the above.

## 10. Tests

`tests/blueprint-importer/phase7_5.test.ts` covers:

- enhanced status mapping (draft/sent/signed/unknown).
- approval object hash determinism.
- approval object rejects empty included candidates and unresolved blockers.
- source_draft_hash changes the batch key; stable when unchanged.
- quantity-only pricing decision blocked.
- catalog resolver output adds blockers for ambiguous / inactive / missing labor rate / low-confidence resolved.

DB constraint behavior (rejecting unknown `enhanced_estimates.status`) is enforced at the migration level and not unit-tested here to avoid mutating production rows.

## 11. RLS / security notes

- `blueprint_estimate_handoff_batches` already has tenant-scoped RLS; the new nullable columns inherit existing policies. No new table created.
- `enhanced_estimates` CHECK constraint is non-RLS, additive.
- No new GRANTs needed (existing grants cover the columns).

## 12. Remaining blockers for Phase 8

1. Runtime catalog/labor resolver implementation (current contract has no executor).
2. Pricing path: either schema-relax `estimate_line_items` to tolerate NULL pricing safely, or require resolver-supplied pricing, or require user-confirmed prices before any live insert.
3. Transactional bridge writer (`estimate_line_items` + `blueprint_estimate_line_provenance` in one tx) — contract documented, not implemented.
4. Approval-object runtime: surface for users to submit approvals, server-side recomputation of `deterministic_approval_hash`, and DB-level prevention of `approved_for_live_handoff` without resolved blockers.
5. UI affordances for approval review, exclusions, warning acknowledgment.

## 13. Phase 8 readiness decision

**Blocked.** Recommend Phase 7.6 to resolve item 2 (pricing path) and define the runtime approval surface, then Phase 8 for the live writer.

## 14. Verification checklist

- [x] Phase 7 docs re-read.
- [x] `enhanced_estimates` statuses inspected; no unknown values.
- [x] `enhanced_estimates.status` CHECK constraint added.
- [x] Migration created and applied.
- [x] `estimate_line_items` NULL-pricing inspected — quantity-only unsafe.
- [x] Approval-object storage decision: columns + JSON payload.
- [x] `source_draft_hash` required in deterministic batch key contract.
- [x] No runtime route behavior changed.
- [x] No document-worker route changed.
- [x] No UI changed.
- [x] No worker behavior changed.
- [x] No live estimate writes implemented.
- [x] No `estimate_line_items` writes.
- [x] No `enhanced_estimates` rows mutated.
- [x] Catalog resolver NOT implemented (contract only).
- [x] Catalog resolver contract written.
- [x] Pricing contract written.
- [x] Schema diff verification completed.
- [x] TS contracts updated.
- [x] Python contracts updated.
- [x] JSON schemas added.
- [x] Examples added.
- [x] Tests added and passing.

**Recommended next phase:** Phase 7.6 (pricing/resolver runtime contract finalization) before Phase 8.
