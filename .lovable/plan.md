# Company CRM Signup Referral System — Implementation Plan

## Goal
Add a complete, self-contained **Company CRM Signup Referral System** to the codebase, separate from the existing homeowner referral system (`/ref/:referralCode`) and the report viewer (`/r/:token`). Nothing in those flows is modified. Subscription/webhook wiring is explicitly out of scope and queued for the next phase.

## Route separation (enforced)
- Keep: `/ref/:referralCode`, `/ref/:referralCode/reward` (homeowner — untouched)
- Keep: `/r/:token` (report viewer — untouched)
- Add: `/signup-ref/:partnerCode` (public partner landing + signup form)
- Add: `/app/settings/company-referrals` (or new tab inside existing Settings if the project uses tabbed settings)

All new tables, functions, files, hooks, and components are prefixed `crm_referral_*` / `companyReferrals*` / `CompanyReferral*` so they cannot collide with the homeowner system.

## Phase 1 — Implementation status doc
Create `src/lib/companyReferrals/IMPLEMENTATION_STATUS.md` first, with the full checklist exactly as you specified. Each item starts `MISSING` and gets flipped to `COMPLETE` as it's built. Final QA section at the bottom.

## Phase 2 — Supabase migration
One migration adds 10 tables, exactly as specified:

1. `crm_referral_partners`
2. `crm_referral_links`
3. `crm_referral_signup_events`
4. `crm_referral_company_signups`
5. `crm_referral_payout_profiles`
6. `crm_referral_program_settings`
7. `crm_referral_payouts`
8. `crm_referral_account_credit_ledger`
9. `crm_referral_flags`
10. `crm_referral_status_history`

Plus the listed indexes. RLS on every table:
- Anon: no direct read/write — all public traffic goes through edge functions (service role).
- Authenticated company users: read rows where `referring_company_id = effective tenant`.
- Admin/owner role (existing pattern via `has_role` / `is_master`): full management.
- `platform_admin` role not yet defined → TODO comment + reuse master/owner check temporarily.

## Phase 3 — Edge functions
Create the 8 functions exactly as specified. All use `npm:` specifiers and `Deno.serve(handler)`, with CORS, Zod validation, and structured JSON errors:

1. `create-crm-referral-partner` (auth admin) — generates `CRM-NAME-XXXX` code, inserts partner + default link, returns `signup_referral_url = ${PUBLIC_APP_URL}/signup-ref/${partner_code}`.
2. `get-public-crm-referral-page` (public) — safe fields only, never payout settings.
3. `track-crm-referral-event` (public) — IP hashed with `CRM_REFERRAL_IP_HASH_SALT` (falls back to `REFERRAL_IP_HASH_SALT`); >20 events / partner / IP in 10 min raises `suspicious_click_velocity` flag.
4. `submit-crm-referral-company-signup` (public) — validates, normalizes email/phone, dedupes within `duplicate_window_days` against email/phone/website/company name, marks duplicates and flags them.
5. `attach-crm-referral-to-new-company` (auth/internal) — resolves attribution via partner_code → visitor/session → owner_email; writes status history.
6. `sync-crm-referral-subscription-status` (auth/internal) — updates signup status, re-evaluates eligibility, creates pending payout if eligible. (Webhooks wire into this later.)
7. `approve-crm-referral-payout` (auth admin) — calculates amount if absent; `account_credit` path writes ledger + sets `account_credit_applied`; other methods set `approved` (never `paid` here).
8. `mark-crm-referral-payout-paid` (auth admin) — flips to `paid`, stamps `paid_at`, stores reference.

## Phase 4 — Public signup-ref page
- `src/pages/PublicCompanySignupReferralPage.tsx` mounted at `/signup-ref/:partnerCode` in `publicRoutes`.
- `PublicCompanySignupReferralHero.tsx` with the exact copy you provided.
- `PublicCompanySignupReferralForm.tsx` with the full field set, trade dropdown, required consent.
- Event tracking on load (`page_view`), first focus (`click_start_signup`), submit start (`signup_started`), submit success (`signup_submitted`).
- Attribution persisted to `localStorage`/`sessionStorage` with TTL = `cookie_attribution_days`.
- Zero payout info exposed publicly.

## Phase 5 — Backend settings UI
`src/pages/app/settings/CompanyReferralSettingsPage.tsx` rendered as a new **Company Referrals** tab inside the existing `IntegrationsSettings` / Settings tab system (this project uses tabbed settings, not standalone pages).

Tabs inside the page: Program Settings, Partners, Company Signups, Payouts, Account Credits, Flags / Review, Analytics — each backed by its own component as specified. All defaults match your spec ($500 fixed fee, `active_paid` trigger, 365-day dedupe window, 90-day cookie, admin approval required).

## Phase 6 — Frontend libs + hooks
All files exactly as specified under `src/lib/companyReferrals/*` and `src/hooks/companyReferrals/*`. Every list/query uses `useEffectiveTenantId()` and filters explicitly by `referring_company_id`.

## Phase 7 — Signup-flow attribution hook
Add `attachCompanyReferralAfterSignup()` helper. Search for the most likely company-creation point (multi-tenancy onboarding edge function / company-creation hook). If located, call it post-creation. If ambiguous, drop a clearly-labeled `TODO(company-referrals-attribution)` comment at the candidate sites — never break existing onboarding.

## Phase 8 — Manual "Mark Active Paid" fallback
In the Company Signups table: row action that opens a dialog (plan, qualifying revenue, first_payment_at, active_paid_at, notes), then calls `sync-crm-referral-subscription-status` with `status='active'`. This unblocks payout testing before Stripe webhooks are wired.

## Phase 9 — QA + status flip
Run through the 18-point QA list, flip every entry in `IMPLEMENTATION_STATUS.md` to `COMPLETE` or annotate `PARTIAL` with reason. Final status line at the bottom.

## Technical notes
- All new code uses semantic Tailwind tokens — no raw colors.
- Edge functions: `npm:@supabase/supabase-js@2`, Zod validation, CORS preflight, structured `{success, error_code, human_message}` errors.
- Public submission endpoints rate-limited via the click-velocity flag + Supabase service role only (anon never writes).
- `PUBLIC_APP_URL` resolved from existing env (defaults to `https://pitch-crm.ai` per project memory).
- No changes to `pipeline_entries`, SMS blast, measurement, PDF engine, ABC OAuth, or homeowner referrals.

## Out of scope (next prompt)
- Stripe / payment-provider webhook handling that calls `sync-crm-referral-subscription-status` automatically.
- Retained-period enforcement beyond the `minimum_paid_amount` setting.
- Tax form (W-9) collection workflow beyond the `tax_form_status` field.

## Verification at the end
1. `/signup-ref/TEST-CODE` renders hero + form (404-style fallback if code unknown).
2. `/app/settings/company-referrals` (or Settings → Company Referrals tab) loads all 7 sub-tabs.
3. Creating a partner returns a copyable signup URL.
4. Submitting the public form creates a `crm_referral_company_signups` row + `signup_submitted` event.
5. "Mark Active Paid" flips status, creates a pending payout when eligibility passes.
6. Approve + Mark Paid moves the payout through `approved` → `paid`.
7. `/ref/:referralCode`, `/ref/:referralCode/reward`, `/r/:token` all still load unchanged.
