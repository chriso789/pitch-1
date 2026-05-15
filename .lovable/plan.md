## Referral Automation + Eligibility Sync — Plan

### Schema reality check (already in DB)
- `referral_submissions`: has `tenant_id`, `crm_lead_id`, `crm_contact_id`, `crm_job_id`, `status`, `payout_eligible`, `payout_eligibility_reason`, `estimated_value`, `sold_value`. **Missing**: `collected_revenue`, `sold_at`, `completed_at`, `cancelled_at`, `appointment_completed_at`, `admin_override_eligible`, `admin_override_reason`.
- `referral_program_settings`: has `payout_trigger`, `minimum_collected_revenue`, `max_rewards_per_referrer_per_year`, `duplicate_window_days`, `block_self_referrals`, `require_admin_approval`, `is_enabled`, reward fields, allow_* method toggles. **Missing**: `reward_expiration_days`, `minimum_days_before_payout`, `allow_self_referrals` (we'll keep `block_self_referrals` and invert), `block_existing_customers`, `block_existing_leads_in_duplicate_window`.
- `referral_status_history`, `referral_payouts`, `referral_credit_ledger`, `referral_flags`, `referral_payout_profiles`, `referral_codes`: present and usable.
- CRM tables: `pipeline_entries` + `pipeline_stages` (leads/jobs lifecycle), `jobs`, `projects`, `project_payments`, `project_invoices`, `payments`. Tenancy is `tenant_id` everywhere (not `company_id`).

### Phase A — Migration (one batch)
Add to `referral_submissions`: `collected_revenue numeric default 0`, `sold_at`, `completed_at`, `cancelled_at`, `appointment_completed_at`, `admin_override_eligible boolean`, `admin_override_reason text`.

Add to `referral_program_settings`: `reward_expiration_days int`, `minimum_days_before_payout int default 0`, `block_existing_customers boolean default true`, `block_existing_leads_in_duplicate_window boolean default true`.

SQL helpers (SECURITY DEFINER, tenant-scoped):
- `get_referrer_credit_balance(tenant_id, referrer_contact_id) returns numeric`
- `get_referrer_rewards_paid_this_year(tenant_id, referrer_contact_id) returns table(count int, amount numeric)`
- `referral_submission_has_blocking_flags(referral_submission_id) returns boolean`
- `calculate_referral_reward(tenant_id, referral_submission_id) returns numeric`

### Phase B — Frontend service layer
- `src/lib/referrals/referralStatusMapping.ts` — maps `pipeline_stages.name`/`jobs.status`/`projects.status` strings (loose `includes` match) into the 9 referral submission statuses + 4 job buckets (sold/completed/cancelled/paid). Documented fallback to `new` when unknown.
- `src/lib/referrals/referralHistory.ts` — `insertReferralStatusHistory`, `getReferralStatusTimeline`.
- `src/lib/referrals/referralAutomation.ts` — all 8 functions from spec (sync from lead, sync from job, evaluate, createPendingPayoutIfEligible, calculateReferralRewardAmount, rejectReferralPayout, updateReferralFinancials, adminOverrideReferralEligibility). Eligibility implements all 10 blocking rules + 5 trigger modes from the spec.

### Phase C — Edge functions
- `supabase/functions/sync-referral-status/index.ts` — accepts `{type:"lead"|"job"|"referral_submission", id}`, runs the corresponding sync server-side using service-role client, returns `{ old_status, new_status, payout_eligible, payout_eligibility_reason, pending_payout_created }`.
- `supabase/functions/evaluate-referral-eligibility/index.ts` — evaluates + optionally creates pending payout. Returns full eligibility payload.

Both use `Authorization: Bearer <user JWT>`, validate the user belongs to the submission's tenant via `user_company_access`, then run with service role.

### Phase D — CRM hookpoints (non-blocking)
- Add a thin wrapper `src/lib/referrals/triggerReferralSync.ts` that fires-and-forgets `sync-referral-status` and toasts only on failure (admin/dev visible).
- Hook into existing pipeline stage change handler (`usePipelineData` / pipeline mutation paths) — call wrapper after success when `pipeline_entries.id` matches a referral's `crm_lead_id` or `crm_job_id`.
- Hook into job/project status updates and payment recorded paths the same way.
- If no central payment writer is reachable, expose manual `collected_revenue` field in dashboard drawer.

### Phase E — Dashboard UI
- Extend `ReferredLeadsTable` with columns: Eligibility badge, Blocking reason (truncated), Recommended next step. Row actions: Recheck, Override eligible/blocked, Update financials, Approve payout.
- Extend `ReferralDetailDrawer` with a "Payout Eligibility" section showing trigger rule, blocking reasons list, recommended step, computed payout amount + method, existing payout status, Recheck + Override buttons.
- New `ReferralEligibilityOverrideDialog.tsx` — radio (eligible/not), required reason, optional amount + method. Calls `adminOverrideReferralEligibility` then `evaluate-referral-eligibility`.
- Add eligibility hook `useReferralEligibility(submissionId)` returning live result via TanStack Query.

### Phase F — Pending payout creation rules
Inside `createPendingPayoutIfEligible`:
- Pull preferred method from `referral_payout_profiles`; default to `manual_review` with note when missing.
- `payout_amount` from `calculateReferralRewardAmount`.
- If `require_admin_approval = false` AND method = `stored_balance`: insert credit ledger row + payout `stored_as_credit`. For `venmo|zelle|gift_card`: payout `approved` (admin still marks paid). Otherwise: `pending`.
- Idempotent: skip if existing payout in `approved|paid|stored_as_credit`; update method/amount if `pending` and inputs changed.

### Phase G — Notifications
Use `sonner` toasts inside the dashboard mutation handlers ("Referral now eligible", "Pending payout created", "Sync failed"). No external/customer notifications.

### Phase H — QA
Add `docs/referral-automation-qa.md` with the 20-step checklist for manual verification.

### Out of scope (next phase)
Analytics + CSV exports come after this. Any UI for editing the new settings fields will be light (added to existing `ReferralSettingsPanel`).

### Order of execution
1. Run migration (Phase A) — pause for approval.
2. Write mapping + history + automation services (B).
3. Write edge functions (C) — auto-deploy.
4. Wire CRM hookpoints (D).
5. Update dashboard UI + override dialog (E).
6. Add settings panel fields + QA doc.

Ready to proceed once you approve the plan and the migration in step 1.