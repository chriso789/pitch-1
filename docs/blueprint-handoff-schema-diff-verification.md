# Blueprint — Handoff/Provenance Schema Diff Verification

**Status:** Phase 7.5. Live schema confirmed against logical contracts.

## blueprint_estimate_handoff_batches

Matches Phase 5.5 contract. Phase 7.5 additions:

- `approval_object jsonb` (nullable)
- `approval_statement_version text` (nullable)
- `deterministic_approval_hash text` (nullable)
- `approval_status text` (CHECK constrained, nullable)
- `approval_required boolean NOT NULL DEFAULT true`
- `approval_blockers jsonb NOT NULL DEFAULT '[]'`
- `approval_warnings jsonb NOT NULL DEFAULT '[]'`

Indexes / unique constraints / RLS / tenant_id presence: unchanged.

## blueprint_estimate_line_candidates

Matches Phase 5.5 contract. `source_measurement_ids` and `plan_path_ids` are `NOT NULL` arrays; non-empty enforcement lives in `validateCandidateHasPlanPath` / `validateCandidateHasMeasurements` (DB does not check array length). `trade_id = 'windows_doors'` block is enforced in `validateCandidateTradeAllowed`. No DB-level constraint needed for Phase 7.5; helpers cover it.

## blueprint_estimate_line_provenance

Matches the logical bridge contract. `live_estimate_line_item_id` remains nullable per Phase 5.5 (becomes non-null at Phase 8 commit time). Unique constraint on `deterministic_handoff_key` per tenant exists from Phase 5.5.

## enhanced_estimates

Phase 7.5 addition:

- `status` CHECK constraint: `status IN ('draft','sent','signed')`.

No other changes.

## Gaps deferred to Phase 7.6 / Phase 8

- No DB CHECK enforcing `array_length(source_measurement_ids, 1) >= 1`. Helpers enforce.
- No DB CHECK preventing `trade_id = 'windows_doors'` candidate inserts. Helpers enforce.
- No DB trigger preventing `approval_status = 'approved_for_live_handoff'` when `approval_blockers` is non-empty. Documented; helpers enforce.
- Transactional bridge writer not implemented.
