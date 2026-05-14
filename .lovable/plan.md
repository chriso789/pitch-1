
## Internal Referral Dashboard

### Reuse, don't duplicate
Existing project already has the foundation — we'll build the dashboard on top of it instead of inventing parallel structure.

- **Route**: keep existing `/referrals` (registered in `src/routes/protectedRoutes.tsx`). The spec says `/app/referrals`, but this app does not use an `/app` prefix anywhere — `/referrals`, `/contacts`, `/jobs`, etc. are top-level. I'll keep `/referrals` and update the sidebar nav item to point to it. (Confirm if you actually want a separate `/app/referrals` route.)
- **Tenant scoping**: project uses `tenant_id` + `useEffectiveTenantId()` (per project memory), not `company_id`/`organization_id`. All queries will use that pattern.
- **Tables already present**: `referral_codes`, `referral_submissions`, `referral_events`, `referral_payouts`, `referral_rewards`, `referral_credit_ledger`, `referral_flags`, `referral_send_logs`, `referral_status_history`, `referral_program_settings`, `referral_conversions`. No migrations expected — I'll verify columns match the spec while wiring each tab and only migrate if a needed column is missing.
- **Edge functions already deployed**: `create-referral-link`, `approve-referral-payout`, `mark-referral-payout-paid`, `apply-referral-credit-to-job`, `referral-manager`, `submit-referral-lead`, `referral-track-event`, `save-referral-payout-preference`, `referral-rewards-processor`. Will call via existing `src/lib/referrals/api.ts` pattern (extended in `adminApi.ts`).
- **Existing thin page** `src/pages/ReferralDashboard.tsx` will be rewritten as the new tabbed shell (preserving the import in `protectedRoutes.tsx`).

### File plan

**Page shell (rewrite)**
- `src/pages/ReferralDashboard.tsx` — tabbed shell (Overview / Links / Leads / Payouts / Credits / Flags / Settings) inside `GlobalLayout`, role-gated actions via existing role hook.

**Tab components** (`src/components/referrals/admin/`)
- `ReferralOverview.tsx` — KPI cards, funnel, clicks/submissions-by-day charts (recharts, already in project), top referrers, source breakdown.
- `ReferralLinksTable.tsx` + `CreateReferralLinkDialog.tsx` + `SendReferralLinkDialog.tsx`
- `ReferredLeadsTable.tsx` — filters, status transitions, CRM lead/job links when `crm_lead_id` / `crm_job_id` present.
- `ReferralPayoutsTable.tsx` — approve / reject / mark paid / convert-to-credit.
- `ReferralCreditsTable.tsx` + ledger drawer + apply-credit dialog.
- `ReferralFlagsTable.tsx` — severity badges, resolve actions.
- `ReferralSettingsPanel.tsx` — bound to `referral_program_settings` with the documented defaults; warning box about compliance.
- `ReferralDetailDrawer.tsx` — opened from every table (referrer info, timeline from `referral_events` + `referral_status_history`, leads, payout history, stored credit, flags, internal notes).

**Data layer**
- `src/lib/referrals/adminApi.ts` — all `getX` / mutation functions listed in Phase 12, every query `.eq('tenant_id', effectiveTenantId)`. Reuses `invoke()` from existing `api.ts` for edge-function calls.
- `src/hooks/referrals/useReferralDashboard.ts` — overview aggregates (parallel queries via `useQueries`).
- `src/hooks/referrals/useReferralSettings.ts` — load/save with create-on-first-save fallback.
- `src/hooks/referrals/useReferralActions.ts` — mutations + toast + query invalidation.

**Sidebar nav**
- Add "Referrals" entry to existing sidebar config under Sales/CRM section using a Gift/Share icon. Visible to all authenticated tenant users; mutating actions gated by role inside components (owner/admin/manager via existing `useUserRole`/`hasRole` hook — I'll confirm exact hook name during implementation).

### Role gating
- View-only: any tenant member.
- Create/copy/send links, change lead statuses: sales/office and above.
- Approve/reject/mark-paid payouts, apply credits, edit settings: owner/admin/manager only. Buttons hidden + server-side enforced via existing edge-function auth.

### Messaging
- SMS via existing Telnyx send function if present (will detect during implementation); email via existing transactional sender. If neither is wired for arbitrary recipients, fall back to "Copy only" mode with the documented notice. Every send attempt logged to `referral_send_logs`.

### Public routes — untouched
`/ref/:referralCode`, `/ref/:referralCode/reward`, `/r/:token` are not modified.

### QA
Dev-only `referralQa.ts`-style checklist logged to console behind a `?qa=1` query flag (no visible debug UI in production), covering the Phase 14 verification list.

### Out of scope (explicit)
- No new edge functions.
- No schema migrations unless a referenced column is genuinely missing (will surface before adding).
- No changes to public referral pages or `PublicReportViewer`.
- No deep CRM-job integration buttons yet — that's the next step you mentioned.

### Open questions
1. Keep route at `/referrals` or actually add a second `/app/referrals` route? (current app has no `/app` prefix)
2. Confirm preferred sidebar section: "Sales", "Marketing", or new "CRM Tools" group.
