
# Fix: Quote View Page - Full Page PDF, SMS Notification, and Accept Quote Signature

## Issues Identified

### Issue 1: PDF is displayed in a sub-window (not full page)
**Current State:** The `ViewQuote.tsx` page shows the PDF inside a `MobilePDFViewer` component which is embedded within a card, constrained to a small viewport (50-70vh height) with zoom controls and toolbars.

**Root Cause:** The design wraps the PDF in multiple containers (`Card > CardContent > MobilePDFViewer`) with max-width constraints and internal height limits.

**Fix:** Redesign the layout to make the PDF viewer full-page/full-height with company header pinned at the top and action buttons pinned at the bottom.

---

### Issue 2: SMS not sent when quote is opened
**Current State:** The edge function logs show:
```
Failed to send SMS notification: {"success":false,"error":"Invalid source number..."}
```

**Root Cause:** The `track-quote-view` edge function calls `telnyx-send-sms` but:
1. It doesn't pass the `tenant_id` to the SMS function (required to look up location phone numbers)
2. Without `tenant_id`, the SMS function can't find a valid from number

**Fix:** Update `track-quote-view` to pass `tenant_id` in the SMS request body so `telnyx-send-sms` can resolve the correct outbound phone number.

---

### Issue 3: "Accept Quote" button does nothing
**Current State:** The button is rendered but has no `onClick` handler:
```tsx
<Button size="lg" ... >
  <CheckCircle className="w-5 h-5 mr-2" />
  Accept Quote
</Button>
```

**Root Cause:** No functionality implemented to:
1. Create a signature envelope for this quote
2. Redirect to the signature capture page

**Fix:** Implement a flow that:
1. On click, calls an edge function to create a signature envelope for the estimate
2. Redirects the customer to `/sign/{access_token}` for digital signature capture

---

## Implementation Plan

### File 1: `src/pages/ViewQuote.tsx`

**Changes:**
1. **Full-page PDF layout:**
   - Remove Card wrapper around PDF
   - Make PDF viewer take full available height (using CSS calc and flexbox)
   - Pin header at top, action buttons at bottom
   - Use a cleaner, more immersive viewing experience

2. **Accept Quote functionality:**
   - Add state for signature flow (`isCreatingSignature`, `signatureUrl`)
   - Add `handleAcceptQuote` function that:
     - Calls new edge function `request-quote-signature`
     - Creates signature envelope for the estimate
     - Returns signing URL
     - Navigates to signing page or shows inline signature capture

3. **UI improvements:**
   - Make the "Accept Quote" button trigger the signature flow
   - Show loading state while creating signature request
   - Optional: Show inline signature capture component instead of redirect

### File 2: `supabase/functions/track-quote-view/index.ts`

**Changes:**
- Add `tenant_id` to the SMS request body:
```typescript
body: JSON.stringify({
  to: repProfile.phone,
  message: smsMessage,
  tenant_id: trackingLink.tenant_id,  // ADD THIS
  sent_by: trackingLink.sent_by,      // ADD THIS for logging
})
```

### File 3: `supabase/functions/request-quote-signature/index.ts` (NEW)

**Purpose:** Create a signature envelope for a quote and return the signing URL

**Flow:**
1. Accept `token` (quote tracking token)
2. Validate token and get estimate data
3. Create signature envelope using existing `create-signature-envelope` logic
4. Return signing access token/URL

---

## Technical Details

### Updated ViewQuote Layout Structure
```tsx
<div className="min-h-screen flex flex-col">
  {/* Pinned Header */}
  <header className="...">Company branding</header>
  
  {/* Full-height PDF Container */}
  <main className="flex-1 flex flex-col overflow-hidden">
    <MobilePDFViewer 
      className="flex-1 min-h-0"
      // Remove height constraints, let it fill available space
    />
  </main>
  
  {/* Pinned Actions */}
  <footer className="sticky bottom-0 bg-background p-4 border-t">
    <Button onClick={handleAcceptQuote}>Accept Quote</Button>
    <Button>Download PDF</Button>
  </footer>
</div>
```

### Accept Quote Handler
```typescript
const handleAcceptQuote = async () => {
  setIsCreatingSignature(true);
  try {
    const { data, error } = await supabase.functions.invoke('request-quote-signature', {
      body: { token }
    });
    
    if (error) throw error;
    
    // Redirect to signature page
    window.location.href = `/sign/${data.access_token}`;
  } catch (err) {
    toast.error('Failed to prepare signature request');
  } finally {
    setIsCreatingSignature(false);
  }
};
```

### SMS Fix in track-quote-view
```typescript
// Line ~281 in track-quote-view/index.ts
const smsResponse = await fetch(`${supabaseUrl}/functions/v1/telnyx-send-sms`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${supabaseServiceKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    to: repProfile.phone,
    message: smsMessage,
    tenant_id: trackingLink.tenant_id,  // NEW - enables location phone lookup
    sent_by: trackingLink.sent_by        // NEW - for audit logging
  })
});
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/pages/ViewQuote.tsx` | Modify | Full-page PDF layout + Accept Quote handler |
| `supabase/functions/track-quote-view/index.ts` | Modify | Add tenant_id to SMS request |
| `supabase/functions/request-quote-signature/index.ts` | Create | New function to create signature envelope from quote token |

---

## Expected Results

After implementation:
1. **Full-page PDF:** Customer sees the quote PDF filling most of the screen, with header and action buttons pinned
2. **SMS notifications work:** Sales rep receives text when quote is opened (requires valid Telnyx number configured for the tenant's location)
3. **Accept Quote works:** Clicking the button creates a signature envelope and redirects to the digital signature page
4. **Complete flow:** Customer can view quote → Accept → Sign digitally → Estimate marked as "signed"

---

## Verification Steps

1. **PDF Layout:** Open a quote link and verify PDF fills the viewport with minimal wrappers
2. **SMS:** Open a quote and check edge function logs for successful SMS delivery (requires Telnyx phone configured)
3. **Signature Flow:**
   - Click "Accept Quote"
   - Verify redirect to signature page
   - Complete signature
   - Verify estimate status updates to "signed"
