# Pipeline Hardening PR — Manager Approval Gate + C-L-J Numbering

## What already exists (do not rebuild)

- `clj_sequences` (tenant-scoped counters), `contacts.clj_number` / `clj_formatted_number`, `projects.clj_formatted_number` + `contact_number`/`lead_number`/`job_number`.
- `manager_approval_queue` (status, approved_by, approved_at, estimated_value, business_justification, priority).
- `manager_approval_history` (audit table — previous_status, new_status, performed_by, action, notes).
- `pipeline_entries.approval_gate_status`, `manager_approval_status`, `requires_manager_approval`.
- Edge function `api-approve-job-from-lead` enforces approval queue check for >$25k.
- React hook `useApprovalGate` with tiered thresholds; `ManagerApprovalQueue` + `ManagerApprovalDialog` UIs.

## Confirmed gaps (this PR closes them)

1. **Direct DB bypass.** `src/pages/LeadDetails.tsx:570` updates `pipeline_entries.status='project'` directly, skipping the edge function and approval gate entirely.
2. **No DB-level enforcement.** RLS lets any rep with write access set `status='project'` from the client. The edge function is the only check.
3. **Threshold-only gating.** Today only >$25k is gated. Spec requires *every* Lead→Project conversion to require an approval event (the threshold determines *which manager role* can approve, not whether approval is needed).
4. **C-L-J columns are not immutable.** Nothing blocks rewriting `clj_number` / `clj_formatted_number` after assignment.
5. **C-L-J uniqueness not enforced per-tenant** on `contacts`, `pipeline_entries`, `projects`.
6. **No idempotent backfill** for existing rows missing C-L-J identifiers.
7. **Rejected/revoked approvals are not consistently logged** in `manager_approval_history`.
8. **No tests** covering bypass attempts, concurrent ID assignment, or backfill idempotency.

## PR scope (one focused commit set)

### Migration 1 — C-L-J integrity

- `UNIQUE (tenant_id, clj_number)` on `contacts`, `pipeline_entries`, `projects` (partial index `WHERE clj_number IS NOT NULL`).
- Immutability trigger on each: `BEFORE UPDATE` → if `OLD.clj_number IS NOT NULL AND NEW.clj_number IS DISTINCT FROM OLD.clj_number` → `RAISE EXCEPTION`. Same for `clj_formatted_number`.
- Idempotent backfill function `public.backfill_clj_numbers(p_tenant_id uuid)` that assigns C-L-J to any row missing one, using `clj_sequences` advisory locks. Safe to re-run.

### Migration 2 — Approval gate enforcement at DB layer

- New function `public.has_active_approval(p_pipeline_entry_id uuid) RETURNS boolean` — security definer, checks `manager_approval_queue.status='approved'`.
- New trigger `enforce_lead_to_project_approval` on `pipeline_entries` `BEFORE UPDATE`:
  - When `OLD.status != 'project' AND NEW.status = 'project'`:
    - Allow if caller has role `master` or `owner` (via `has_role`) — they remain override-capable, logged.
    - Otherwise require `has_active_approval(NEW.id)` = true; else `RAISE EXCEPTION 'lead_to_project_requires_approval'`.
  - Always insert a row into `manager_approval_history` recording the transition attempt (success or block).
- Add trigger to also block `INSERT` into `projects` with `pipeline_entry_id` set unless approval exists or caller is master/owner.

### Migration 3 — Audit completeness

- Trigger on `manager_approval_queue` `AFTER UPDATE OF status` → write `manager_approval_history` row for every status change (pending → approved / rejected / revoked / expired). Today only manual writes happen.

### Edge function updates

- `api-approve-job-from-lead`: keep the existing tiered-role check; remove the `>$25k` short-circuit so *every* conversion verifies an approval row exists (master/owner still bypass). Conversion already routes through this function for the canonical path.

### Frontend updates

- `src/pages/LeadDetails.tsx`: replace the direct `pipeline_entries.update({status:'project'})` at line 570 with `supabase.functions.invoke('api-approve-job-from-lead', { body: { pipelineEntryId } })`. Show the existing approval-required dialog if it returns `requires_approval: true`.
- `src/hooks/useApprovalGate.ts`: change default thresholds so `requiresApproval` is true for all non-manager conversions (threshold table now governs *which* role can approve, not *whether*).
- Pipeline Kanban (`KanbanCard.tsx`): disable the "Mark as Project" / drag-to-project action for non-managers when no approval row exists; show pending state badge.

### Tests

`tests/integration/approval-gate.test.ts`:
1. Rep without approval → conversion blocked (edge function 403 AND direct DB update raises).
2. Manager creates approval → rep conversion succeeds.
3. Master/owner can override without approval row (and override is audited).
4. Direct `supabase.from('pipeline_entries').update({status:'project'})` from a rep token is rejected by the trigger.
5. Concurrent `backfill_clj_numbers` calls produce unique IDs (10 parallel).
6. Re-running backfill is a no-op for already-numbered rows.
7. Updating `clj_number` on an existing row raises immutability error.

## Out of scope (next PRs)

- Referral attribution wiring + Stripe subscription webhook (PR #2, as you outlined).
- Address validation, weather pause, unified comms timeline.
- Measurement-system changes.

## Definition of done

- ✅ No `pipeline_entries.status` can flip to `'project'` without either a master/owner caller or a matching `manager_approval_queue` row in `approved` status — enforced by trigger, not just by edge function.
- ✅ No `projects` row with `pipeline_entry_id` can be inserted by a non-master/owner without an approval row.
- ✅ Every contact, lead, and project has a unique, immutable C-L-J identifier per tenant; backfill is idempotent.
- ✅ Every status transition on `manager_approval_queue` writes to `manager_approval_history`.
- ✅ All 7 tests above pass in `npm run test`.
- ✅ Build + typecheck clean.
