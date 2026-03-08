

# Fix Telnyx Connection ID Secret

## Problem
The `TELNYX_CONNECTION_ID` secret holds an invalid value. Telnyx rejects it with a 422 error.

## Fix
Update the `TELNYX_CONNECTION_ID` Supabase secret to `2849056557713327385` (the Application ID from the PITCH CRM Voice app).

No code changes needed -- the edge functions already read this secret correctly via `ENV.TELNYX_CONNECTION_ID`.

## User Action Required
Verify the Telnyx webhook URL is set to:
`https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/telnyx-call-webhook`

(The screenshot shows it may be truncated/different.)

