## Problem

The QuickBooks popup is actually completing the OAuth flow correctly — Intuit redirects back, the popup posts the auth code to the opener, and the opener calls the `qbo-oauth-connect` edge function with `action: callback`. The popup then closes, which makes the button reset to "Connect to QuickBooks", giving the impression that nothing happened.

Edge function logs confirm the real failure:

```
Failed to store connection:
  code: 22P02
  message: malformed array literal: "com.intuit.quickbooks.accounting openid email profile"
```

The `qbo_connections.scopes` column is a Postgres `text[]`, but in `supabase/functions/qbo-oauth-connect/index.ts` the upsert passes `scopes` as a single space-separated string literal. The insert fails, no row is stored, and the UI silently shows "Not Connected".

## Fix

Single targeted change in `supabase/functions/qbo-oauth-connect/index.ts` inside the `callback` action upsert:

1. Replace the hard-coded string with an array, sourced from Intuit's token response when available and falling back to the known scopes:
   ```ts
   scopes: (tokens.scope ? tokens.scope.split(/\s+/) : [
     'com.intuit.quickbooks.accounting',
     'openid',
     'email',
     'profile',
   ]),
   ```
2. Make sure `TokenResponse` includes the optional `scope?: string` field so TypeScript is happy.

No other files, no schema migration, no frontend changes. After redeploy, the existing popup flow will succeed and the UI will flip to "Connected".

## Verification

1. Click **Connect to QuickBooks** from `/settings` on `https://pitch-crm.ai` (same-origin so popup messaging is unaffected).
2. Complete Intuit login.
3. Expect: popup closes, toast "Connected to QuickBooks" appears, card shows the company name and "Connected" badge.
4. Re-check `qbo-oauth-connect` logs — no `22P02` error; a successful upsert into `qbo_connections`.

## Out of scope

- The earlier preview-vs-production cross-origin `postMessage` fix already shipped (`targetOrigin: '*'`) and is unrelated to this failure.
- Job-type → QBO item mapping UI.
- Token refresh / disconnect flows.
