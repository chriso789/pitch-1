# Blueprint — Existing-Line Resolution Policy

**Status:** Phase 7 contract doc. No code, no DB changes.

Defines how a future Phase 8 live-write implementation must respond when a `deterministic_handoff_key` already exists somewhere in the system. Companion to [`blueprint-importer-phase-7-live-handoff-approval-contract.md`](./blueprint-importer-phase-7-live-handoff-approval-contract.md).

## 1. Inputs to the policy

For each candidate evaluated for live write, the resolver inspects:

- `blueprint_estimate_line_candidates` row for the candidate (by `deterministic_handoff_key`).
- `blueprint_estimate_line_provenance` row(s) matching the key, if any.
- `estimate_line_items` row referenced by any matching provenance bridge row.
- Current session's `source_draft_hash` vs. the batch's stored `source_draft_hash`.
- Target `enhanced_estimates.tenant_id` and `status` vs. caller and status mapping.

## 2. Scenario matrix

| # | Scenario | Default action | Blocker / note |
|---|---|---|---|
| 1 | Key exists in candidates only (no bridge, no live line) | **skip_if_identical** when current preview matches; otherwise treat as a normal new live write. | — |
| 2 | Key exists in `blueprint_estimate_line_provenance` (bridge row present) | Treat the bridge as authoritative; do not create a second live line. | If bridge points to a live line that no longer exists, block with `EXISTING_LINE_AT_KEY_NEEDS_DECISION`. |
| 3 | `live_estimate_line_item_id` exists for the key (bridge + live line) | Update path is gated by §4 below. | Default: **skip** unless user explicitly approves update. |
| 4 | Live line exists but no provenance bridge row | **hard_block** | `PROVENANCE_BRIDGE_REQUIRED` |
| 5 | Source draft changed → new candidate but key collision with prior batch | **version_or_supersede_if_source_draft_changed** | Mark prior candidate `superseded`; new candidate must go through full approval. |
| 6 | Candidate `quantity` changed vs. prior live line | **require_user_choice_if_quantity_or_formula_changed** | `EXISTING_LINE_AT_KEY_NEEDS_DECISION` until user picks `skip`/`update_live_line_after_explicit_approval`/`create_new_version`. |
| 7 | Candidate `formula_inputs` changed | Same as #6. | Same. |
| 8 | Target `enhanced_estimates` changed (different estimate id) | New key surface; previous live line is unaffected. | Approval object MUST reference the new target id. |
| 9 | Previous batch was `superseded` | New batch's candidates evaluated normally; do not auto-promote superseded candidates. | — |
| 10 | Previous live line was user-edited after handoff | **block_if_live_line_user_edited** | `EXISTING_LINE_USER_EDITED` — no automatic update; user must explicitly create a new version or skip. |
| 11 | Previous live line `tenant_id` ≠ caller | **hard_block_on_tenant_mismatch** | `TENANT_MISMATCH` |
| 12 | Two candidates in the same batch resolve to the same key | **block** the batch (deterministic-key collision indicates a generator bug) | `DETERMINISTIC_HANDOFF_KEY_COLLISION` |

"User-edited" detection (#10) requires Phase 7.5 to define a marker — either a checksum recorded in the bridge row at write-time, or an `edited_after_handoff_at` column on `estimate_line_items`. Phase 7 does not pick the mechanism.

## 3. Allowed future actions

For any scenario that does not hard-block, the future resolver may emit one of:

- `skip` — no write; candidate marked as already-handled.
- `update_preview_candidate` — staging-only update on `blueprint_estimate_line_candidates`; never touches live line.
- `supersede_candidate` — staging-only; mark prior candidate `superseded`, create a new candidate in the new batch.
- `create_new_version` — write a new live line and a new bridge row; prior live line untouched.
- `update_live_line_after_explicit_approval` — only after the approval object specifically lists the candidate in `included_candidate_ids` AND the resolution choice is `update`.
- `block_and_require_manual_review` — emit the relevant blocker; no write.

None of these actions are implemented in Phase 7.

## 4. Update path (live-line mutation) guardrails

`update_live_line_after_explicit_approval` is the only path that mutates an existing `estimate_line_items` row, and only if:

- The bridge row exists and matches `tenant_id`.
- The live line has not been user-edited (per the §2 #10 marker).
- The approval object explicitly enumerates this candidate's id in `included_candidate_ids` AND the user's resolution choice is `update`.
- The recomputed `deterministic_approval_hash` matches the stored hash.

If any of those fail, fall back to `block_and_require_manual_review`.

## 5. Recommended default policy (summary)

- **skip_if_identical** for exact duplicates.
- **block_if_live_line_user_edited** in all other update cases.
- **require_user_choice_if_quantity_or_formula_changed**.
- **version_or_supersede_if_source_draft_changed**.
- **hard_block_on_tenant_mismatch**.
- **hard_block_on_missing_provenance_for_existing_live_line**.
- **never destructively overwrite without explicit user approval.**

## 6. Phase 7.5 prerequisites

- Add a user-edit marker on `estimate_line_items` or on the bridge row.
- Add `superseded` lifecycle to `blueprint_estimate_line_candidates` (column or status enum extension).
- Extend the approval object schema to carry per-candidate resolution choices (`skip` / `update` / `create_new_version`).
