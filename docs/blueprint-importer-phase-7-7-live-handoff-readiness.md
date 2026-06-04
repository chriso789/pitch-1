# Blueprint Importer — Phase 7.7: Final Live-Handoff Readiness Contract

**Status:** Phase 7.7. Docs only. No code, no DB, no endpoint, no worker, no UI, no schema, no migration. No live writes enabled.

Phase 7.7 is a go/no-go review for crossing from preview into live CRM estimate writes. It resolves the two Phase 7.6c deviations by contract, locks the live-write preconditions, and decides whether Phase 8 implementation may begin.

## 1. Scope

- Finalize Phase 8 readiness matrix.
- Close Phase 7.6c deviations by contract.
- Lock live-write preconditions, output contract, provenance bridge rule, existing-line policy, approval object requirements, and pricing/write mapping.
- Produce a Phase 8 implementation checklist.
- Render a Phase 8 readiness decision.

## 2. Non-goals

- No code changes.
- No DB migration.
- No endpoint/route/worker/UI changes.
- No shared TS / Python / JSON schema changes (only doc cross-refs).
- No Push to Estimate. No `estimate_line_items` / `enhanced_estimates` / `proposal_tier_items` writes. No provenance bridge writes. No catalog/labor mutation. No final pricing implementation. No custom-line approval implementation.
- Do not start Phase 8.

## 3. Phase 7.6c acceptance

Phase 7.6c is accepted per the approval boundary:

- Pricing preflight implemented inside the existing `document-worker` route family.
- Target validation implemented for `product_catalog`, `supplier_catalog_items`, `abc_catalog_items`, `labor_rates`.
- Quantity-only mode unconditionally blocked.
- Zero-default pricing unconditionally blocked.
- No live writes; `handoff_allowed` remains `false`.
- 177/177 blueprint-importer tests passing.
- No catalog/labor mutation, no `estimate_line_items` / `enhanced_estimates` / `proposal_tier_items` / provenance writes.

Phase 7.6c deviations, accepted and now closed by contract in this phase:

1. **`supplier_catalog_items` tenant-scoping.** Phase 7.6c does not join through `supplier_catalogs.tenant_id`; it falls back to binding-level cost. Closed by [`blueprint-supplier-catalog-tenant-scope-contract.md`](./blueprint-supplier-catalog-tenant-scope-contract.md).
2. **ABC pricing source.** ABC pricing lives in webhook price rows, not on `abc_catalog_items`. Phase 7.6c uses `binding.unit_cost` for ABC preview cost. Closed by [`blueprint-abc-pricing-source-contract.md`](./blueprint-abc-pricing-source-contract.md).

Both contracts are gating: their blocker codes must be wired into Phase 8 preflight before any live write is permitted.

## 4. Supplier catalog tenant-scope decision

See [`blueprint-supplier-catalog-tenant-scope-contract.md`](./blueprint-supplier-catalog-tenant-scope-contract.md). Live writes that rely on `supplier_catalog_items` MUST verify tenant via the `supplier_catalogs.tenant_id` join. Binding-level cost may stand in only when the binding itself is active, tenant-scoped, approved, and carries an explicit `unit_cost` — and the approval object explicitly records that binding-level cost was used.

## 5. ABC pricing source decision

See [`blueprint-abc-pricing-source-contract.md`](./blueprint-abc-pricing-source-contract.md). `abc_catalog_items` identifies items only. Cost must come from a trusted ABC price source (webhook price rows) OR from binding-level `unit_cost` with explicit user confirmation captured in the approval object. Zero-default ABC pricing is forbidden.

## 6. Final Phase 8 readiness matrix

See [`blueprint-live-handoff-readiness-matrix.md`](./blueprint-live-handoff-readiness-matrix.md) for the full table.

Allowed result values:

- `ready_for_phase_8`
- `blocked_requires_7_7_fix`
- `blocked_requires_schema_change`
- `blocked_requires_runtime_resolver_change`
- `blocked_requires_pricing_contract_change`
- `blocked_requires_catalog_data`
- `blocked_requires_user_approval_flow`
- `blocked_requires_provenance_bridge_test`

## 7. Live-write preconditions (Phase 8 runtime)

Phase 8 may write live estimate lines only if ALL preconditions are true. Any false precondition is a hard block.

Target estimate:

- Target `enhanced_estimates` row exists.
- Target belongs to the caller's tenant.
- Target `status = 'draft'` (per existing CHECK constraint).
- No concurrent edit token / row-version mismatch.

Preview batch:

- Preview `blueprint_estimate_handoff_batches` row is current (not `superseded`, not `cancelled`, not `failed`).
- `source_draft_hash` matches the candidate's current source draft.
- Candidate belongs to the batch.
- Candidate is not superseded.

Candidate completeness:

- `source_measurement_ids` non-empty.
- `plan_path_ids` non-empty.
- `source_document_ids` non-empty.
- `deterministic_handoff_key` present and unique per tenant.
- Resolved binding present (`catalog_resolution_status = 'resolved'`).
- Candidate is in `included_candidate_ids` of the approval object.

Resolver + preflight:

- Target validation passed (Phase 7.6c contract).
- Pricing preflight passed (Phase 7.6c contract).
- Quantity-only mode NOT used.
- Zero-default pricing NOT used.
- Supplier catalog tenant-join rule passes when applicable.
- ABC price-source rule passes when applicable.
- Labor rate rule passes when applicable.
- Unit conversion rule passes when applicable.

Review flags:

- No blocking `blueprint_review_flags` remain for the candidate or batch.
- All required warnings are acknowledged via `acknowledged_warning_ids`.

Approval:

- Approval object is complete (see §10).
- `deterministic_approval_hash` recomputes equal server-side.
- Existing-line-at-key policy is resolved (see §9).

Provenance / transaction:

- Provenance bridge write is available.
- Live write + provenance bridge write occur in one transaction.
- No proposal/tier recalculation side effect is unsafe (see §11).

## 8. Live-write output contract

See [`blueprint-estimate-line-write-mapping-contract.md`](./blueprint-estimate-line-write-mapping-contract.md) for field-level mapping.

Allowed Phase 8 writes (only after approval):

- `estimate_line_items` (insert; update only via explicit existing-line policy path).
- `blueprint_estimate_line_provenance` (insert in same transaction).
- `blueprint_estimate_handoff_batches` — status / approval / live-write metadata only.
- `blueprint_estimate_line_candidates` — status / live-write metadata only.
- `blueprint_review_flags` — live-write blockers/failures only.

Forbidden in Phase 8 unless separately approved:

- `proposal_tier_items` writes.
- Proposal finalization.
- Work order creation.
- Purchase order creation.
- Invoice creation.
- Production task creation.
- `product_catalog` / `labor_rates` / `supplier_catalog_items` / `abc_catalog_items` / `material_item_match_rules` mutation.
- Custom non-catalog line creation.
- Automatic tax / discount / margin / markup inference.

## 9. Provenance bridge final rule

Re-confirms [`blueprint-provenance-bridge-live-write-contract.md`](./blueprint-provenance-bridge-live-write-contract.md):

- `estimate_line_items` insert and `blueprint_estimate_line_provenance` insert MUST happen in one DB transaction.
- Every Phase-8 `estimate_line_items` row from the blueprint importer MUST have exactly one bridge row.
- Bridge insert failure → rollback the `estimate_line_items` insert.
- `estimate_line_items` insert failure → rollback the bridge insert.
- No bridge row may be written for preview-only candidates.
- `deterministic_handoff_key` is unique per tenant (existing index enforces).
- Existing live line at the same key follows the existing-line policy (see §10).

## 10. Existing-line final policy

Re-reads and finalizes [`blueprint-existing-line-resolution-policy.md`](./blueprint-existing-line-resolution-policy.md). Phase 8 default behavior per scenario:

| scenario | default |
|---|---|
| Identical existing live line at key | **skip** (no-op; record idempotent hit) |
| Existing line edited by user | **block** — require manual review |
| Source quantity changed | **block** — require explicit user approval to update or create new version |
| Source formula changed | **block** — require explicit user approval to update or create new version |
| Target estimate changed (different `enhanced_estimates.id`) | **block** unless explicitly approved |
| Missing provenance for existing line at key | **block** |
| Tenant mismatch | **hard block** |
| Deterministic key collision across batches | **hard block** |

Updates and new-version writes are permitted only via the explicit approval path; never inferred.

## 11. Approval object final requirements

Re-reads and finalizes [`blueprint-handoff-approval-object-contract.md`](./blueprint-handoff-approval-object-contract.md). Phase 8 requires:

- `approval_status = 'approved_for_live_handoff'`.
- `approval_object` exists and validates against the JSON schema.
- `included_candidate_ids` and `excluded_candidate_ids` present.
- Every candidate to be written is in `included_candidate_ids`.
- `approval_blockers` empty.
- All required warnings acknowledged via `acknowledged_warning_ids`.
- `catalog_mode` approved.
- `pricing_mode` approved (and not `quantity_only`).
- `custom_line_mode = 'disabled'` unless separately approved.
- `deterministic_approval_hash` recomputes equal server-side at write time.
- `source_draft_hash` equals current preview batch `source_draft_hash`.
- `target_enhanced_estimate_id` equals the actual target row id.
- `approval_statement_version` matches current contract version.

Blocker codes (must be emitted by Phase 8 preflight):

- `USER_APPROVAL_MISSING`
- `USER_APPROVAL_HASH_MISMATCH`
- `USER_APPROVAL_STALE_SOURCE_DRAFT`
- `USER_APPROVAL_TARGET_MISMATCH`
- `USER_APPROVAL_CANDIDATE_SELECTION_MISMATCH`
- `USER_APPROVAL_WARNINGS_NOT_ACKNOWLEDGED`
- `USER_APPROVAL_BLOCKERS_UNRESOLVED`

## 12. Pricing / write mapping contract

See [`blueprint-estimate-line-write-mapping-contract.md`](./blueprint-estimate-line-write-mapping-contract.md).

Critical invariants:

- Default `0` values on `unit_cost`, `extended_cost`, `total_price` are NEVER valid pricing.
- Markup is NEVER invented.
- Customer price is NEVER inferred.
- If `estimate_line_items` cannot be filled safely, Phase 8 blocks.
- If preflight supports cost but not customer price, Phase 8 remains blocked unless the existing estimate flow demonstrably accepts cost-only draft lines without corrupting tier totals or `enhanced_estimates` aggregates. As of Phase 7.7, that has NOT been verified — see `blueprint-live-handoff-pricing-contract.md` §2.

## 13. Phase 8 implementation checklist

Preflight validations:

- Re-run resolver v2 inside the live-write transaction.
- Re-run pricing preflight inside the live-write transaction.
- Verify supplier catalog tenant-join.
- Verify ABC price source.
- Verify labor rate, unit conversion.

Approval validations:

- Recompute deterministic approval hash; compare to persisted.
- Validate `source_draft_hash` freshness.
- Validate target id, candidate selection, warnings/blockers state.

Target estimate validations:

- Row exists, tenant match, `status='draft'`, no concurrent-edit conflict.

Candidate validations:

- Belongs to batch, not superseded, has all required provenance arrays, has deterministic key, has resolved binding.

Pricing validations:

- No quantity-only. No zero-default. Cost source matches the documented priority and tenant-safety contract.

Provenance transaction:

- Single DB transaction for `estimate_line_items` + `blueprint_estimate_line_provenance`.
- Rollback on either failure.

Existing-line handling:

- Deterministic-key lookup BEFORE insert; apply §10 policy.

Idempotency:

- Re-submission of same approved batch is a no-op when keys match; never duplicates.

Rollback behavior:

- On any precondition failure inside the transaction, rollback; record `blueprint_review_flags` with failure code.

RLS / tenant checks:

- Every read filters `.eq('tenant_id', resolvedTenantId)`.
- Every write sets `tenant_id = resolvedTenantId`.
- Service-role writes still apply tenant filter to source-of-truth reads.

Tests required:

- Happy-path single-candidate live write.
- Multi-candidate batch live write.
- Approval hash mismatch → block.
- Stale `source_draft_hash` → block.
- Quantity-only mode → block.
- Zero-default pricing → block.
- Supplier tenant-mismatch → block.
- ABC price-row missing → block.
- Existing-line scenarios (each row in §10 table).
- Bridge insert failure → estimate insert rolled back.
- Estimate insert failure → bridge insert rolled back.
- Tenant cross-write attempt → hard block.
- Idempotent re-submit → no duplicates.

UI required:

- Approval review screen surfaces all blockers/warnings/included/excluded candidate ids before "Approve for live handoff".
- Live-write action disabled until approval object is `approved_for_live_handoff`.
- Failure surfaces all returned blocker codes and links to flags.

Disabled actions that remain after Phase 8:

- Custom non-catalog line approval runtime.
- Proposal finalization automation.
- Work order / PO / invoice / production task automation.
- Catalog/labor mutation from the importer.
- Tax / discount / margin / markup inference.

## 14. Phase 8 readiness decision

**Decision: C — Phase 7.8 required (small hardening phase before Phase 8 implementation).**

Rationale:

- All contractual gates are now documented (this phase) and the two Phase 7.6c deviations are closed by contract.
- However, Phase 8 cannot safely begin until at least the following are verified by code or test, NOT just contract:
  1. `enhanced_estimates` tier aggregation behavior when a cost-only draft line is inserted (see [`blueprint-live-handoff-pricing-contract.md`](./blueprint-live-handoff-pricing-contract.md) §6). If aggregation corrupts tier totals or proposal/tier downstream values, Phase 8 must block until customer-price is also resolvable.
  2. Supplier catalog tenant-join verified end-to-end in the resolver/preflight path (`supplier_catalog_items` → `supplier_catalogs.tenant_id`).
  3. ABC price-source row availability and freshness verified in a test fixture; binding-cost fallback gated behind explicit user confirmation in the approval object.
  4. Deterministic-key uniqueness behavior and existing-line policy exercised by tests against `blueprint_estimate_line_provenance`.

Phase 7.8 scope (proposed, NOT approved here): a focused hardening + test phase that verifies the four items above without writing any production live data. Phase 8 implementation may begin only after Phase 7.8 acceptance.

## 15. Implementation gaps

- Supplier catalog tenant-safe join is not yet executed in code; only contracted here.
- ABC price-row source rows are not yet read by the preflight; only contracted here.
- Cost-only draft line behavior on `enhanced_estimates` tier subtotals is unverified.
- Existing-line scenarios are documented but not yet under test coverage against `blueprint_estimate_line_provenance`.
- Approval UI does not yet capture explicit "binding-level cost used in place of catalog source" confirmation.

## 16. Stop conditions

- No live write may begin while ANY readiness-matrix gate is not `ready`.
- No live write may begin while ANY Phase 7.6c-deviation blocker code is un-wired in the runtime.
- No live write may begin while `enhanced_estimates` tier aggregation behavior is unverified for cost-only draft lines.
- No catalog/labor mutation may originate from the importer at any time in Phase 8.

## 17. Verification checklist

- [x] Phase 7.6c docs re-read.
- [x] Supplier catalog tenant-scope decision written.
- [x] ABC pricing source decision written.
- [x] Readiness matrix written.
- [x] Live-write preconditions written.
- [x] Output contract written.
- [x] Provenance bridge final rule written.
- [x] Existing-line final policy written.
- [x] Approval object final requirements written.
- [x] Pricing/write mapping contract written.
- [x] Phase 8 implementation checklist written.
- [x] Phase 8 readiness decision: **C — Phase 7.8 required**.
- [x] Code changed: **no**.
- [x] DB changed: **no**.
- [x] Endpoint behavior changed: **no**.
- [x] Worker behavior changed: **no**.
- [x] UI changed: **no**.
- [x] Push to Estimate enabled: **no**.
- [x] Live estimate writes implemented: **no**.
- [x] `estimate_line_items` written: **no**.
- [x] `enhanced_estimates` updated: **no**.
- [x] `proposal_tier_items` written: **no**.
- [x] Provenance bridge rows written: **no**.
- [x] Catalog/labor rows mutated: **no**.

Deviations:

- None introduced in Phase 7.7. The two Phase 7.6c deviations are closed by contract here; they remain runtime gaps to be closed in Phase 7.8.

Recommended next phase: **Phase 7.8 — runtime hardening + test coverage for supplier tenant-join, ABC price source, cost-only tier aggregation, and existing-line scenarios.** Phase 8 implementation remains blocked until Phase 7.8 acceptance.
