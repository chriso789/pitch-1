# Blueprint — Live Handoff Readiness Matrix (Phase 7.7)

**Status:** Phase 7.7. Docs only. Companion to [`blueprint-importer-phase-7-7-live-handoff-readiness.md`](./blueprint-importer-phase-7-7-live-handoff-readiness.md).

Result values:

- `ready_for_phase_8`
- `blocked_requires_7_7_fix`
- `blocked_requires_schema_change`
- `blocked_requires_runtime_resolver_change`
- `blocked_requires_pricing_contract_change`
- `blocked_requires_catalog_data`
- `blocked_requires_user_approval_flow`
- `blocked_requires_provenance_bridge_test`

## Matrix

| # | Gate | Owner / source | Current status | Required evidence | Phase 8 blocker code | Ready? |
|---|---|---|---|---|---|---|
| 1 | `enhanced_estimates` target status safety | DB CHECK + Phase 7.5 hardening | Contract locked (`draft` only) | Transaction-time recheck of `status='draft'` | `TARGET_ESTIMATE_STATUS_NOT_DRAFT` | `ready_for_phase_8` |
| 2 | Target estimate tenant safety | RLS on `enhanced_estimates` | Verified in policy review | Live tenant match assert | `TARGET_ESTIMATE_TENANT_MISMATCH` | `ready_for_phase_8` |
| 3 | Candidate resolver status | Phase 7.6b runtime | Implemented; covered by tests | `catalog_resolution_status='resolved'` at write | `CANDIDATE_NOT_RESOLVED` | `ready_for_phase_8` |
| 4 | Target validation status | Phase 7.6c preflight | Implemented; covered by tests | `pricing_preflight.target_validation.ok=true` | `TARGET_VALIDATION_FAILED` | `ready_for_phase_8` |
| 5 | Pricing preflight status | Phase 7.6c preflight | Implemented; covered by tests | `pricing_status` is `ready_for_pricing_review` (Phase 8 will lift cap) | `PRICING_PREFLIGHT_FAILED` | `blocked_requires_pricing_contract_change` (cost-only vs customer price) |
| 6 | Quantity-only safety | Pricing contract §4 | Unconditionally blocked in 7.6c | Preflight returns `QUANTITY_ONLY_LIVE_LINES_UNSAFE` | `QUANTITY_ONLY_LIVE_LINES_UNSAFE` | `ready_for_phase_8` |
| 7 | Zero-default pricing safety | Pricing contract §4 | Unconditionally blocked in 7.6c | Preflight returns `ZERO_DEFAULT_PRICING_UNSAFE` | `ZERO_DEFAULT_PRICING_UNSAFE` | `ready_for_phase_8` |
| 8 | Supplier catalog tenant-scope safety | [supplier contract](./blueprint-supplier-catalog-tenant-scope-contract.md) | Contract locked; runtime gap | Live `supplier_catalogs.tenant_id` join executed in resolver/preflight | `SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED` | `blocked_requires_runtime_resolver_change` |
| 9 | ABC pricing source safety | [ABC contract](./blueprint-abc-pricing-source-contract.md) | Contract locked; runtime gap | ABC webhook price row read OR explicit binding-cost confirmation | `ABC_PRICE_SOURCE_REQUIRED` | `blocked_requires_runtime_resolver_change` |
| 10 | Labor rate safety | Pricing preflight + resolver v2 contract | Implemented for present rows | Tenant + active + non-zero rate verified | `LABOR_RATE_MISSING` / `_TENANT_MISMATCH` / `_INACTIVE` | `ready_for_phase_8` |
| 11 | Unit conversion safety | Resolver v2 contract | Contract locked | `source_unit==target_unit` OR `unit_conversion_rule` populated | `UNIT_CONVERSION_REQUIRED` | `ready_for_phase_8` |
| 12 | Approval object completeness | [approval contract](./blueprint-handoff-approval-object-contract.md) | Schema + helpers shipped (Phase 7.5) | `approval_status='approved_for_live_handoff'` + all fields populated | `USER_APPROVAL_MISSING` | `blocked_requires_user_approval_flow` |
| 13 | `source_draft_hash` freshness | Phase 7.5 + 7.6a | Required by deterministic key | Approval hash references current preview batch hash | `USER_APPROVAL_STALE_SOURCE_DRAFT` | `ready_for_phase_8` |
| 14 | Deterministic handoff key uniqueness | Unique index (Phase 5.5) | Enforced by DB | Pre-insert lookup + DB unique constraint | `DETERMINISTIC_HANDOFF_KEY_COLLISION` | `ready_for_phase_8` |
| 15 | Existing-line-at-key policy | [existing-line policy](./blueprint-existing-line-resolution-policy.md) | Contract locked; tests missing | Test coverage of each policy row | `EXISTING_LINE_POLICY_UNRESOLVED` | `blocked_requires_provenance_bridge_test` |
| 16 | Provenance bridge transaction rule | [provenance contract](./blueprint-provenance-bridge-live-write-contract.md) | Contract locked; runtime not built | One-transaction insert + rollback tests | `PROVENANCE_BRIDGE_REQUIRED` | `blocked_requires_provenance_bridge_test` |
| 17 | Selected candidate inclusion/exclusion | Approval object | Schema enforces non-empty `included_candidate_ids` | Approval object validates | `USER_APPROVAL_CANDIDATE_SELECTION_MISMATCH` | `ready_for_phase_8` |
| 18 | Unresolved blocker flags | `blueprint_review_flags` | Resolver+preflight write flags | Zero blocking flags at live-write time | `BLOCKING_REVIEW_FLAGS_PRESENT` | `ready_for_phase_8` |
| 19 | Acknowledged warning flags | Approval object `acknowledged_warning_ids` | Schema enforces | All required warnings acknowledged | `USER_APPROVAL_WARNINGS_NOT_ACKNOWLEDGED` | `ready_for_phase_8` |
| 20 | Preview batch status | `blueprint_estimate_handoff_batches.status` | Enforced by CHECK | `status` not in `superseded/cancelled/failed` | `PREVIEW_BATCH_STALE` | `ready_for_phase_8` |
| 21 | Candidate supersession status | `blueprint_estimate_line_candidates` | Implemented in 7.6b/7.6c | Candidate `metadata.superseded != true` | `CANDIDATE_SUPERSEDED` | `ready_for_phase_8` |
| 22 | Proposal/tier side-effect safety | [pricing contract §2](./blueprint-live-handoff-pricing-contract.md) | Unverified | Confirm `enhanced_estimates` aggregation behavior with cost-only draft lines | `TIER_AGGREGATION_UNSAFE` | `blocked_requires_pricing_contract_change` |
| 23 | RLS / tenant safety | Existing RLS policies | Verified per [tenant reconciliation](./blueprint-tenant-company-catalog-reconciliation.md) | Live transaction asserts `resolvedTenantId` | `TENANT_RLS_FAILURE` | `ready_for_phase_8` |
| 24 | No hidden final-pricing inference | Pricing contract §4 | Locked: no markup/margin/tax/discount inference | Code review confirms no inference paths | `FINAL_PRICING_INFERENCE_FORBIDDEN` | `ready_for_phase_8` |

## Aggregate decision

Not ready: gates 5, 8, 9, 15, 16, 22 are not `ready_for_phase_8`.

Recommended next phase: **Phase 7.8** — close gates 8, 9, 15, 16, 22 with runtime + test coverage. Re-evaluate gate 5 after gate 22 is closed.
