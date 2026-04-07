

## Fix Three Issues: Blank Signing Page, AR Actions, and GitHub Secrets

### Issue 1: "Review Your Proposal" Button Leads to Blank Page

**Root Cause**: The signing URL in emails points to the wrong domain. There are **three different hardcoded URLs** across edge functions, none pointing to the actual published app:

| Edge Function | Current URL | Should Be |
|---|---|---|
| `email-signature-request/index.ts` (line 116) | `https://pitchcrm.app` | `https://pitch-1.lovable.app` |
| `create-share-link/index.ts` (line 134) | `https://pitch-crm.ai` | `https://pitch-1.lovable.app` |
| `generate-proposal/index.ts` (line 529) | Uses `shareUrl` from `create-share-link` | Inherits the wrong URL |

The email screenshot shows `pitch-crm.ai/sign/...` which is not where the app is hosted. The signing page component (`PublicSignatureCapture.tsx`) exists and works -- it just can't be reached because the URL is wrong.

**Fix**: Update both `email-signature-request` and `create-share-link` to use `FRONTEND_URL` env var with fallback to `https://pitch-1.lovable.app`. Set `FRONTEND_URL` as a Supabase secret. Redeploy both functions.

### Issue 2: AR Action Buttons Not Showing

The dropdown menu code exists in `AccountsReceivable.tsx` (lines 345-418) with the three-dot menu button. The user may be seeing the page without data, or the dropdown trigger may not be visible. I will verify the page renders correctly and ensure the action buttons are visible and accessible.

**Fix**: Check if the issue is data-related (no items loading) or if the trigger button styling makes it invisible. May need to make the action button more prominent.

### Issue 3: GitHub Actions Secrets Are Empty

**This is expected.** The screenshot shows the GitHub repository settings page with "This repository has no secrets." The GitHub Actions workflows (`claude-bug-detection.yml`, `claude-code-review.yml`, `claude-documentation.yml`) require secrets to authenticate with APIs.

**Required secrets to add manually in GitHub Settings > Secrets:**

| Secret Name | Purpose |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for edge function auth |
| `ANTHROPIC_API_KEY` | Claude API key for the bug detection/docs workflows |

**This cannot be done programmatically** -- you must add these in the GitHub UI at Settings > Secrets > "New repository secret".

### Files to Edit

| File | Change |
|---|---|
| `supabase/functions/email-signature-request/index.ts` | Fix APP_URL fallback to `https://pitch-1.lovable.app` |
| `supabase/functions/create-share-link/index.ts` | Fix FRONTEND_URL fallback to `https://pitch-1.lovable.app` |
| `src/pages/AccountsReceivable.tsx` | Verify and fix action button visibility |

### Deployments
- Redeploy `email-signature-request`, `create-share-link`, `signer-open`

