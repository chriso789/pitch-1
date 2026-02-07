
# Fix Quote Email Link to Use Correct App URL

## The Problem
When you send a quote email, the "View Your Quote" button links to the wrong domain (`alxelfrbjzkmtnsulcei.lovable.app`) instead of your actual app (`pitch-1.lovable.app`). The current link shows a Lovable placeholder page because it's pointing to the Supabase project's preview domain.

## Root Cause
The edge function is incorrectly building the quote URL by trying to convert the Supabase database URL:
```javascript
// Current (WRONG):
const viewQuoteUrl = `${supabaseUrl.replace('.supabase.co', '.lovable.app')}/view-quote/${trackingToken}`;
// This produces: https://alxelfrbjzkmtnsulcei.lovable.app/view-quote/...
```

## The Fix
Use the `APP_URL` environment variable (already configured in your secrets) to build the link correctly:
```javascript
// Fixed:
const appUrl = Deno.env.get("APP_URL") || "https://pitch-1.lovable.app";
const viewQuoteUrl = `${appUrl}/view-quote/${trackingToken}`;
// This produces: https://pitch-1.lovable.app/view-quote/...
```

## What Will Change

### File: `supabase/functions/send-quote-email/index.ts`
1. Add `APP_URL` environment variable with fallback to published domain
2. Replace the broken URL construction with the correct pattern
3. The email will now link to `https://pitch-1.lovable.app/view-quote/{token}`

## After the Fix
- The "View Your Quote" button will open your actual app
- The quote viewing page will load correctly with the quote data
- View tracking and SMS notifications will work as expected

## Testing
After the fix is deployed:
1. Send a new quote email
2. Open the email and click "View Your Quote"
3. Verify it opens `pitch-1.lovable.app/view-quote/...` and displays the quote
