# Referral Automation + Eligibility Sync — QA Checklist

Manual verification for the automation layer.

1. Create a referral lead via the public `/ref/:code` page.
2. From the dashboard, link the new submission to a CRM lead (`pipeline_entries`) or job and confirm `crm_lead_id` / `crm_job_id` populate.
3. Move the linked CRM lead to a "contacted" stage → referral submission status updates to `contacted`.
4. Move the lead to "appointment scheduled" → status updates to `appointment_set`.
5. Move the lead to "estimate sent" → status updates to `estimate_sent`.
6. Mark the linked job/project as **sold** (status string contains "sold"/"signed"/"contract") → submission status `sold`, `sold_at` populates.
7. With `payout_trigger = job_sold`, eligibility flips to **Eligible** and a pending payout row is created.
8. Record collected revenue (via `payments` row or manual update in drawer) → `collected_revenue` updates.
9. With `payout_trigger = job_paid` and revenue ≥ `minimum_collected_revenue`, eligibility flips to **Eligible** and pending payout is created (or refreshed).
10. Mark the job **completed** → `completed_at` populates; with `payout_trigger = job_completed`, eligibility flips to **Eligible**.
11. Mark a referral as **duplicate** → eligibility blocks with reason "Referral marked duplicate."
12. Self-referral (referrer_contact_id = crm_contact_id) with `block_self_referrals = true` → blocks with "Self-referral is not allowed."
13. Cancel the job (status contains "cancel") → submission status `rejected`, `cancelled_at` populates, eligibility blocked.
14. Use Admin override → Mark eligible: blocks bypassed (except finalized payout); pending payout created.
15. Use Admin override → Mark not eligible: payout blocked with admin reason; cannot recover without lifting override.
16. With an existing `paid` or `stored_as_credit` payout, recheck does **not** create a duplicate.
17. Disable `referral_program_settings.is_enabled` → all submissions block with "Referral program is disabled."
18. Add an unresolved high-severity flag → blocks with "Referral has unresolved high-severity fraud flag."
19. With `require_admin_approval = false` and method `stored_balance`, payout auto-creates as `stored_as_credit` and ledger row is appended.
20. With `require_admin_approval = false` and method `venmo`/`zelle`/`gift_card`, payout auto-creates as `approved` (admin still marks paid manually).
21. Confirm `referral_status_history` has a row for every status change, override, financials update, and payout creation.

## Edge functions

- `POST /sync-referral-status` `{ type: "lead" | "job" | "referral_submission", lead_id|job_id|referral_submission_id }`
- `POST /evaluate-referral-eligibility` `{ referral_submission_id, create_pending_payout?: boolean }`

Both require an authenticated user with `user_company_access` to the submission's tenant.
