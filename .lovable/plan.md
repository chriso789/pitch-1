
# Fix Plan: Quote Email, PDF Display, and SMS Notifications

## Summary of Issues

Based on my investigation, I found three distinct problems:

1. **Email shows the price** - The customer sees "$40,800" before clicking, reducing motivation to open
2. **PDF not loading** - Shows "Quote document will be displayed here" because the PDF path is never passed to the tracking link
3. **SMS notification not sent** - The SMS function rejects the service-to-service call due to user authentication requirements

---

## Root Cause Analysis

### Issue 1: Price in Email
- **Location**: `supabase/functions/send-quote-email/index.ts` (lines 311-317)
- **Problem**: The email template includes a "Total Amount" section showing `selling_price`

### Issue 2: PDF Not Loading
- **Location**: `src/components/estimates/ShareEstimateDialog.tsx` (lines 93-103)
- **Problem**: The `pdf_url` is NOT passed to `send-quote-email` function
- **Evidence**: Database query shows `quote_tracking_links.pdf_url = NULL` for all recent links
- **The estimate HAS a pdf_url**: `d77c963c-163d-49b2-b457-8d9f730e7a28/estimates/OBR-00026-yjwz.pdf`

### Issue 3: SMS Not Sent
- **Location**: `supabase/functions/telnyx-send-sms/index.ts` (lines 52-71)
- **Log Evidence**: `Failed to send SMS notification: {"success":false,"error":"Unauthorized"}`
- **Problem**: The SMS function validates user auth via `supabase.auth.getUser()`, but `track-quote-view` calls it with the service role key (not a user token), so auth fails

---

## Detailed Fix Plan

### Fix 1: Remove Price from Email Template
**File**: `supabase/functions/send-quote-email/index.ts`

Remove the conditional block that displays the selling price:

**Before** (lines 311-317):
```html
${estimate.selling_price ? `
<tr>
  <td style="color: #6b7280; font-size: 14px; padding-top: 12px;">Total Amount</td>
  <td style="text-align: right; color: ${primaryColor}; font-weight: 700; font-size: 20px; padding-top: 12px;">$${Number(estimate.selling_price).toLocaleString()}</td>
</tr>
` : ''}
```

**After**: Remove these lines entirely, keeping only the Quote Number row

---

### Fix 2: Pass PDF URL to Tracking Link
**File**: `src/components/estimates/ShareEstimateDialog.tsx`

Add a prop for `pdfUrl` and pass it to the edge function:

1. Add `pdfUrl?: string;` to the interface (line 26)
2. Include `pdf_url: pdfUrl` in the function body (around line 103)

**Also Required**: `supabase/functions/send-quote-email/index.ts`

Currently the edge function reads `body.pdf_url` but the dialog doesn't send it. The edge function already supports it (line 238):
```typescript
pdf_url: body.pdf_url,
```

So we just need the frontend to pass it.

**Alternative Approach** (more reliable): Have the edge function fetch the `pdf_url` from `enhanced_estimates` when saving the tracking link, instead of relying on frontend:

In `send-quote-email/index.ts`, change line 238 from:
```typescript
pdf_url: body.pdf_url,
```
to:
```typescript
pdf_url: body.pdf_url || estimate.pdf_url,
```

This way if frontend doesn't pass it, we fall back to the estimate's stored PDF path.

But wait - we need to fetch `pdf_url` in the estimate query. Currently (line 116):
```typescript
.select("id, estimate_number, selling_price, pipeline_entry_id, tenant_id")
```
Add `pdf_url` to both estimate queries.

---

### Fix 3: Allow Service-to-Service SMS Calls
**File**: `supabase/functions/telnyx-send-sms/index.ts`

The function currently requires user authentication. For internal service-to-service calls (like from `track-quote-view`), we need to allow the service role key to bypass user auth.

**Solution**: Check if the Authorization header contains the service role key, and if so, skip user authentication:

Add this logic after line 55:
```typescript
const authHeader = req.headers.get('Authorization');
if (!authHeader) {
  throw new Error('Missing authorization header');
}

const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const token = authHeader.replace('Bearer ', '');

// Allow service-to-service calls with service role key
const isServiceCall = token === supabaseServiceKey;

if (!isServiceCall) {
  // Regular user authentication
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !user) {
    throw new Error('Unauthorized');
  }
  // ... continue with user-based tenant lookup
} else {
  // Service call - expect tenant context in body or skip tenant checks
  console.log('Service-to-service call detected, skipping user auth');
}
```

For service calls, we can accept the tenant info in the request body or simplify the from-number resolution.

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/send-quote-email/index.ts` | Remove price display, add `pdf_url` to estimate query, use estimate's pdf_url as fallback |
| `supabase/functions/telnyx-send-sms/index.ts` | Allow service role key to bypass user auth for internal calls |

---

## Testing Plan

After implementation:

1. **Email Test**: Send a new quote email and verify the price is NOT shown in the email
2. **PDF Test**: Click the link in the email and verify the PDF loads in the viewer
3. **SMS Test**: When the quote is opened, verify SMS is received at +17708420812

---

## Expected Behavior After Fix

1. **Email**: Shows "Your Quote is Ready!" with quote number only - no price visible
2. **View Page**: PDF displays immediately when link is clicked
3. **SMS**: Sales rep receives text like "🔔 Nicole Walker just opened quote #OBR-00026-yjwz!"
