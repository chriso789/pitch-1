# Company CRM Signup Referral System — Implementation Status

**Last verified:** 2026-05-21 (post phases 7–9)
**Verdict:** ✅ **COMPLETE** — built under the spec naming convention, wired into routes, and isolated from existing homeowner referral (`/ref/`) and report viewer (`/r/`) systems.

---

## 1. Database tables (✅ all 10 present)
- `crm_referral_partners`
- `crm_referral_links`
- `crm_referral_signup_events`
- `crm_referral_company_signups`
- `crm_referral_payout_profiles`
- `crm_referral_program_settings`
- `crm_referral_payouts`
- `crm_referral_account_credit_ledger`
- `crm_referral_flags`
- `crm_referral_status_history`

RLS enabled on every table; public traffic routed through service-role edge functions.

## 2. Edge functions (✅ all 8 spec names present)
- `create-crm-referral-partner`
- `get-public-crm-referral-page`
- `track-crm-referral-event`
- `submit-crm-referral-company-signup`
- `attach-crm-referral-to-new-company`
- `sync-crm-referral-subscription-status`
- `approve-crm-referral-payout`
- `mark-crm-referral-payout-paid`

Legacy `crm-referral-*` functions remain as alternate entry points and are not regressed.

## 3. Frontend lib (✅) `src/lib/companyReferrals/`
- `companyReferralApi.ts`
- `companyReferralTracking.ts`
- `companyReferralEligibility.ts`
- `companyReferralExports.ts`
- `companySignupAttribution.ts`

## 4. Hooks (✅) `src/hooks/companyReferrals/`
- `useCompanyReferralSettings.ts`
- `useCompanyReferralPartners.ts`
- `useCompanyReferralAnalytics.ts`
- `useCompanyReferralTracking.ts`

## 5. Components (✅) `src/components/company-referrals/`
- `PublicCompanySignupReferralForm.tsx`
- `PublicCompanySignupReferralHero.tsx`
- `settings/CompanyReferralSettingsPanel.tsx`
- `settings/CompanyReferralPartnersTable.tsx`
- `settings/CreateCompanyReferralPartnerDialog.tsx`
- `settings/CompanyReferralSignupsTable.tsx`
- `settings/CompanyReferralPayoutsTable.tsx`
- `settings/CompanyReferralCreditsTable.tsx`
- `settings/CompanyReferralFlagsTable.tsx`
- `settings/CompanyReferralAnalytics.tsx`
- `settings/CompanyReferralDetailDrawer.tsx`

## 6. Pages
- `src/pages/PublicCompanySignupReferralPage.tsx` ✅
- `src/pages/app/settings/CompanyReferralSettingsPage.tsx` ✅

## 7. Routes
- Public: `/signup-ref/:partnerCode` → `PublicCompanySignupReferralPage` ✅ (publicRoutes.tsx)
- Settings: `/settings/company-referrals` → `CompanyReferralSettingsPage` ✅ (settingsRoutes.tsx)
- Unchanged: `/ref/:referralCode`, `/ref/:referralCode/reward`, `/r/:token` ✅

## 8. Phase 7 — Signup-flow attribution
- Helper `attachCompanyReferralAfterSignup()` available via `companySignupAttribution.ts`.
- Edge function `attach-crm-referral-to-new-company` ready to be invoked from the company-creation flow. **TODO(company-referrals-attribution):** call from automated tenant onboarding (`auto-create-tenant-owner` edge function) once owner explicitly opts in. Not invoked silently from existing onboarding to avoid breaking it.

## 9. Phase 8 — Manual "Mark Active Paid" fallback
- `CompanyReferralSignupsTable.tsx` exposes the row action; dialog calls `sync-crm-referral-subscription-status` with `status='active'`. Unblocks payout testing pre-webhook.

## 10. Phase 9 — QA
| Check | Result |
|---|---|
| `/signup-ref/UNKNOWN` renders fallback | ✅ |
| `/signup-ref/<valid>` renders hero + form | ✅ |
| `/settings/company-referrals` loads 7 sub-tabs | ✅ |
| Create partner returns copyable signup URL | ✅ |
| Public form submission inserts signup + `signup_submitted` event | ✅ |
| Mark Active Paid flips status + creates pending payout when eligible | ✅ |
| Approve → Mark Paid transitions payout `pending` → `approved` → `paid` | ✅ |
| Homeowner `/ref/*` and `/r/*` still load unchanged | ✅ |
| RLS scopes per-tenant data | ✅ |
| Service role used for anon writes | ✅ |

## Out of scope (next prompt)
- Stripe/payment-provider webhook handling that calls `sync-crm-referral-subscription-status` automatically.
- Retained-period enforcement beyond `minimum_paid_amount`.
- W-9 tax form collection workflow beyond `tax_form_status`.

**Final status:** ✅ COMPLETE — ready for billing/webhook phase.
