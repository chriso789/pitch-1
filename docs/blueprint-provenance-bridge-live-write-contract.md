# Blueprint — Provenance Bridge Live-Write Contract

**Status:** Phase 7 contract doc. No code, no DB changes.

Defines exactly when and how a future Phase 8 live-write implementation may write to `estimate_line_items` and `blueprint_estimate_line_provenance`. Companion to [`blueprint-importer-phase-7-live-handoff-approval-contract.md`](./blueprint-importer-phase-7-live-handoff-approval-contract.md).

## 1. Bridge write timing

- `blueprint_estimate_line_provenance` MUST NOT be written during preview (Phase 6). Phase 6 writes only `blueprint_estimate_handoff_batches` and `blueprint_estimate_line_candidates`.
- `blueprint_estimate_line_provenance` is written only **after** a live `estimate_line_items` row id has been produced inside the same transaction.

## 2. Transactional contract

A single Phase 8 live-write unit MUST:

1. Begin a transaction.
2. Re-validate all live-write preconditions (status, batch freshness, approval hash, key collision, tenant) inside the transaction.
3. Insert one row into `estimate_line_items` for the candidate.
4. Insert one row into `blueprint_estimate_line_provenance` referencing the new `estimate_line_items.id` and the candidate.
5. Commit.

If `estimate_line_items` insert succeeds but `blueprint_estimate_line_provenance` insert fails → **rollback** (no orphan live line).
If `blueprint_estimate_line_provenance` insert succeeds but `estimate_line_items` insert fails → **rollback** (no dangling bridge).

Updates to existing live lines (the explicit-approval update path) must also write a bridge update / version row in the same transaction.

## 3. Required bridge fields

Every bridge row MUST reference:

- `handoff_batch_id`
- `line_candidate_id`
- `import_session_id`
- `accepted_trade_id`
- `template_binding_id`
- `source_draft_line_id`
- `source_draft_line_type` (`material` | `labor`)
- `source_measurement_ids[]` (non-empty)
- `plan_path_ids[]` (non-empty)
- `source_document_ids[]` (non-empty)
- `formula_key`
- `formula_inputs` (jsonb, canonicalized)
- `approved_by`
- `approved_at`
- `live_written_by`
- `live_written_at`
- `deterministic_handoff_key`
- `tenant_id`
- `live_estimate_line_item_id` (FK to `estimate_line_items.id`)

If any of these inputs is unknown at write-time, emit `PROVENANCE_BRIDGE_REQUIRED` and abort the transaction. Phase 7 does not add or rename columns; the field list above is the logical contract Phase 7.5 must verify against the actual `blueprint_estimate_line_provenance` schema.

## 4. Uniqueness

- `deterministic_handoff_key` MUST be unique per `tenant_id`. A unique index already exists per the Phase 5.5 migration; if the live-write attempt violates it, treat as `DETERMINISTIC_HANDOFF_KEY_COLLISION` and route through the existing-line resolution policy.

## 5. Cross-table invariants

- Every Blueprint-Importer-originated `estimate_line_items` row has exactly one bridge row.
- Every bridge row references a live `estimate_line_items` row that exists and belongs to the same `tenant_id`.
- No bridge row may reference a candidate from a `superseded` batch unless the candidate itself was explicitly approved before supersession.

## 6. Tenant / RLS safety

- All inserts use the caller's `resolvedTenantId` from JWT-derived membership, never from the request body.
- Service-role writes (if used) MUST include `.eq('tenant_id', resolvedTenantId)` on every read used to validate preconditions, and MUST set `tenant_id = resolvedTenantId` on every insert.
- RLS policies on `estimate_line_items` and `blueprint_estimate_line_provenance` MUST be re-verified in Phase 7.5 to confirm tenant isolation under the worker's auth context.

## 7. Audit requirements

For every committed live write, Phase 8 MUST write an audit log entry containing:

- `actor_user_id`
- `tenant_id`
- `action` = `blueprint_live_handoff_write`
- `handoff_batch_id`
- `line_candidate_id`
- `estimate_line_item_id`
- `deterministic_handoff_key`
- `deterministic_approval_hash`
- `pricing_mode`, `catalog_mode`, `custom_line_mode`
- `before` / `after` snapshots for update paths

Audit failures MUST NOT roll back the live write (audit is fire-and-log), but MUST raise an internal alert.

## 8. Failure handling

- DB transaction failure → return blocker `PROVENANCE_BRIDGE_REQUIRED` plus the underlying constraint name; do not retry automatically.
- Approval hash mismatch detected at transaction time → block with `USER_APPROVAL_HASH_MISMATCH`; do not retry.
- Source-draft hash changed during the transaction → block with `PREVIEW_BATCH_STALE`; user must re-preview.
- Partial success is impossible by construction; if observed in logs, treat as a P0 incident.

## 9. Out of scope for Phase 7

- Implementing the transaction helper.
- Adding any new columns to `blueprint_estimate_line_provenance` or `estimate_line_items`.
- Adding any new RLS policies.
- Changing any existing route's behavior.
