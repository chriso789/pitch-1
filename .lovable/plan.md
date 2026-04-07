
Fix broken proposal/signature links and standardize every customer-facing URL on https://pitch-crm.ai

1. Standardize the public app domain
- Add one shared edge-function helper for public URL resolution with this priority: `FRONTEND_URL` → `APP_URL` → `PUBLIC_APP_URL` → fallback `https://pitch-crm.ai`
- Replace scattered hardcoded fallbacks in the signature/share/quote flows so nothing ever falls back to `pitchcrm.app` or `pitch-1.lovable.app`

2. Repair the signature-request flow end to end
- Update all signing-link generators to always produce `https://pitch-crm.ai/sign/:token`
- Fix the legacy signature send path so it no longer relies on the older broken flow if that UI is still active
- Fix reminder emails to use each recipient’s real `access_token` instead of the current hardcoded `"reminder"` placeholder, which creates invalid links

3. Harden the public customer pages
- Keep `src/App.tsx` direct public routes as the source of truth for `/sign/:token` and `/view-quote/:token`
- Improve `PublicSignatureCapture` failure handling so customers get a branded error state instead of a blank white screen if the token or document fails to load
- Verify `signer-open` consistently returns a fresh signed PDF URL for sent envelopes

4. Prevent stale published builds from breaking customer links
- Review `public/sw.js` caching behavior on the published site
- Bump cache keys and remove risky cache-first behavior for app JS/CSS/HTML that can leave customers on stale bundles after deploys
- Make sure `pitch-crm.ai` serves the newest customer flow immediately after publish

5. Sweep remaining public URLs
- Replace remaining user-facing `pitchcrm.app` and `pitch-1.lovable.app` references in:
  - signature emails
  - share links
  - quote emails
  - onboarding/setup/invite links
  - other public app links that customers or staff click from emails

Files to update
- `src/App.tsx`
- `src/pages/PublicSignatureCapture.tsx`
- `src/components/signatures/SignatureStatusDashboard.tsx`
- `public/sw.js`
- `supabase/functions/email-signature-request/index.ts`
- `supabase/functions/send-signature-envelope/index.ts`
- `supabase/functions/create-share-link/index.ts`
- `supabase/functions/send-quote-email/index.ts`
- `supabase/functions/_shared/email-config.ts`
- `supabase/functions/_shared/setup-tokens.ts`
- `supabase/functions/initialize-company/index.ts`
- `supabase/functions/send-user-invitation/index.ts`
- `supabase/functions/provision-tenant-owner/index.ts`
- `supabase/functions/admin-create-user/index.ts`
- `supabase/functions/seed-company-owners/index.ts`

Technical details
- I found three active signature/share functions still pointing at `pitchcrm.app`
- I found several onboarding/invite/setup functions still pointing at `pitch-1.lovable.app`
- I found the reminder flow currently sending `access_token: "reminder"` instead of the real recipient token
- The public routes already exist for `/sign/:token` and `/view-quote/:token`, so the remaining risk is bad link generation, stale published bundles, and weak public-page failure handling

Validation after implementation
- Send a fresh quote email and confirm “Review Your Proposal” opens `https://pitch-crm.ai/view-quote/:token`
- From that quote page, click Accept Quote and confirm redirect to `https://pitch-crm.ai/sign/:token` with the PDF visible
- Send a direct signature request email and confirm its button opens `https://pitch-crm.ai/sign/:token`
- Send a reminder email and confirm it reuses the recipient’s real token
- Test on the published domain in an incognito window and on mobile to confirm cached clients no longer get the blank page
