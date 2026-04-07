

## Complete Remaining Tasks

The `FRONTEND_URL` secret is already configured. No more setup needed. Here's what remains:

### 1. Deploy Updated Edge Functions
Deploy the three functions that were already edited with the `pitchcrm.app` domain:
- `email-signature-request`
- `create-share-link`
- `send-signature-envelope`

Also redeploy `signer-open` (the gateway function for public signing pages).

### 2. Fix AR Action Button Visibility
Investigate and fix why the dropdown actions aren't showing in the Accounts Receivable page. Will check `AccountsReceivable.tsx` for rendering issues — could be conditional rendering hiding the menu, or a styling/z-index problem.

### Files to Change
- Deploy only (no code changes needed — URLs were already updated in previous messages)
- `src/pages/AccountsReceivable.tsx` — fix action button visibility if needed

