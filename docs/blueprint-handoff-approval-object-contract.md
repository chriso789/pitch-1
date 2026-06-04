# Blueprint — Handoff Approval Object Contract

**Status:** Phase 7.5. Storage decided; runtime not implemented.

## 1. Storage

`blueprint_estimate_handoff_batches` extended with nullable columns:

- `approval_object jsonb` — full structured payload.
- `approval_statement_version text`.
- `deterministic_approval_hash text`.
- `approval_status text` — CHECK-constrained to `approval_not_started|approval_in_review|approval_ready|approved_for_live_handoff|approval_revoked|approval_superseded|approval_failed`.
- `approval_required boolean DEFAULT true`.
- `approval_blockers jsonb DEFAULT '[]'`.
- `approval_warnings jsonb DEFAULT '[]'`.

## 2. Shape

See `docs/schemas/blueprint-importer/blueprint-handoff-approval-object.schema.json` and TS/Python `ApprovalObject`.

Required fields:

- `contract_version`, `approval_statement_version`
- `approved_by`, `approved_at`
- `import_session_id`, `handoff_batch_id`
- `target_enhanced_estimate_id`
- `included_candidate_ids`, `excluded_candidate_ids`
- `acknowledged_warning_ids`, `resolved_blocker_ids`
- `catalog_mode`, `pricing_mode`, `custom_line_mode`
- `source_draft_hash`
- `approval_status`, `approval_blockers`, `approval_warnings`
- `deterministic_approval_hash`

## 3. Determinism

`createDeterministicApprovalHash` produces a SHA-256 over canonicalized inputs. Hash MUST be recomputed server-side at live-write time and compared to the persisted value. Mismatch → `APPROVAL_HASH_MISMATCH`.

## 4. Invariants

- An approval object alone NEVER triggers live write. It is a prerequisite gate.
- `approval_status = approved_for_live_handoff` is never set by Phase 7.5 runtime (no runtime exists).
- `included_candidate_ids` must be non-empty.
- `approval_blockers` must be empty.
- `custom_line_mode = enabled` requires `CUSTOM_LINE_MODE_REVIEWED` in `resolved_blocker_ids`.

## 5. Helpers

- `validateApprovalObjectShape(a)` → blocker codes.
- `validateApprovalHash(a)` → `{ ok, expected, got }`.
- `validateSourceDraftHashFresh(approval_hash, current_hash)` → boolean.
- `validateTargetStatusForLiveWrite(status)` → live-write decision.
