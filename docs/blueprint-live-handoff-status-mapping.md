# Blueprint — Live Handoff Status Mapping

**Status:** Phase 7 contract doc. No code, no DB changes.

Maps `enhanced_estimates.status` values to live-handoff behavior. Companion to [`blueprint-importer-phase-7-live-handoff-approval-contract.md`](./blueprint-importer-phase-7-live-handoff-approval-contract.md).

## 1. Evidence

- Table: `public.enhanced_estimates`, column `status text NOT NULL DEFAULT 'draft'`.
- CHECK constraints on `enhanced_estimates`: only `pricing_tier` and `selected_tier` are enum-constrained (`good|better|best`). **`status` has no CHECK constraint.**
- Distinct values observed in production data: `draft`, `sent`, `signed`.
- Code paths that write `status` (sampling):
  - `src/components/estimates/MultiTemplateSelector.tsx` → `'draft'`
  - `src/components/estimates/TemplateSectionSelector.tsx` → `'draft'`
  - `src/components/estimates/SavedEstimatesList.tsx` → `'draft'`
  - `src/components/estimates/PaymentsTab.tsx` → `'sent'`
  - No code path writes `'signed'` directly; it is set via signature/proposal flow.
- No `'locked'`, `'approved'`, `'archived'`, or `'cancelled'` status is currently emitted.

## 2. Mapping table

| `enhanced_estimates.status` | `can_preview` | `can_live_write` | `can_update_existing_blueprint_lines` | `requires_user_confirmation` | `blocked_reason_code` | Notes |
|---|---|---|---|---|---|---|
| `draft` | yes | **yes** | yes (only Blueprint-owned lines, never user-edited) | yes (full §7 approval) | — | Only safe live-write target today. |
| `sent` | yes | no | no | n/a | `TARGET_ESTIMATE_SENT` | Estimate has been delivered; mutation risks customer-facing drift. |
| `signed` | yes | no | no | n/a | `TARGET_ESTIMATE_APPROVED` | Customer signature collected — treat as locked. |
| any other text value | yes | no | no | n/a | `TARGET_ESTIMATE_STATUS_UNKNOWN` | Conservative default until status is constrained. |
| row missing | no | no | no | n/a | `TARGET_ESTIMATE_MISSING` | — |
| row exists, `tenant_id` ≠ caller | no | no | no | n/a | `TARGET_ESTIMATE_TENANT_MISMATCH` | Hard-fail. |
| future `locked` value | yes | no | no | n/a | `TARGET_ESTIMATE_LOCKED` | Reserved. |
| future `archived` value | yes | no | no | n/a | `TARGET_ESTIMATE_ARCHIVED` | Reserved. |
| future `cancelled` value | yes | no | no | n/a | `TARGET_ESTIMATE_CANCELLED` | Reserved. |

## 3. Tier mapping requirement

`enhanced_estimates` supports tiered pricing (`pricing_tier`, `selected_tier`). For Phase 8:

- Live handoff MUST target the tier explicitly chosen by the user in the approval object.
- If `pricing_tier` is set but the user has not chosen a target tier in the approval object, block with `TARGET_ESTIMATE_TIER_MAPPING_REQUIRED`.
- Tier mapping must be deterministic and recorded in the approval object's `metadata`.

## 4. Unknown status behavior

If `enhanced_estimates.status` is any value not in `{draft, sent, signed}` (and not in the reserved list), Phase 8 MUST block with `TARGET_ESTIMATE_STATUS_UNKNOWN`. Live-write code may not infer behavior from unknown values.

## 5. Recommended Phase 7.5 hardening (not implemented here)

- Add a CHECK constraint or Postgres enum on `enhanced_estimates.status` covering the known values plus any new lifecycle states.
- Add a `locked_at` / `sent_at` / `signed_at` audit columns review.
- Audit code paths that write `status` to make sure no string outside the constrained set can be inserted.

Phase 7 itself makes no schema change. The constraint and audit work is Phase 7.5 scope.
