

# Fix Hardcoded Unverified Domain in Signature Emails

## Problem

The `email-signature-request` edge function hardcodes `signatures@pitchcrm.app` as the "from" address (line 170), but `pitchcrm.app` is NOT a verified domain in your Resend account. Your verified domains are:

- obriencontractingusa.com
- tristatecontracting.co
- pitch-crm.ai
- prepyourproperty.ai

Resend silently rejects the email, so the function appears to succeed but nothing is delivered.

## Fix

### `supabase/functions/email-signature-request/index.ts`

Change line 170 from:

```text
from: `${tenantName} <signatures@pitchcrm.app>`
```

to use the `RESEND_FROM_DOMAIN` environment variable (same pattern every other edge function uses):

```text
const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
...
from: `${tenantName} <signatures@${fromDomain}>`
```

This single change makes signature emails use the same verified domain as all other outbound emails in the system.

### Redeploy

Redeploy `email-signature-request` after the fix.

## Technical Details

- Only one file changes: `supabase/functions/email-signature-request/index.ts`
- Two lines affected: add a `fromDomain` variable near the top of the handler, and update the `from` field in the Resend payload
- No UI changes needed
- No database changes needed

