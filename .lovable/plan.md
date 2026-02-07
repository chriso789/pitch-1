
# Plan: Add Share Button with Tracked Email and SMS Notifications

## Overview

Add a "Share" button to the Estimate Preview Panel that sends a trackable email to the customer. When the customer opens and views the estimate, the sales rep receives an SMS text notification to their phone - both on initial open AND every subsequent reopen.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SHARE ESTIMATE FLOW                                   │
└─────────────────────────────────────────────────────────────────────────────────┘

  [Rep clicks "Share"]           [Customer opens link]          [Rep gets SMS]
         │                              │                              │
         ▼                              ▼                              ▼
┌─────────────────┐            ┌─────────────────┐            ┌─────────────────┐
│ ShareEstimate   │            │ /view-quote/:id │            │ telnyx-send-sms │
│ Dialog          │            │ Public page     │            │ (to rep's phone)│
│                 │            │                 │            │                 │
│ • Recipient     │   EMAIL    │ • Tracks view   │   TRIGGER  │ • Instant alert │
│   email/name    │ ─────────► │ • Records event │ ─────────► │ • Every view    │
│ • Custom msg    │            │ • Logs duration │            │ • View count    │
└─────────────────┘            └─────────────────┘            └─────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐            ┌─────────────────┐
│ send-quote-email│            │ track-quote-view│
│                 │            │ (enhanced)      │
│ • Creates       │            │                 │
│   tracking_link │            │ + SMS to rep    │
│ • Sends Resend  │            │ + Rep phone     │
│   email         │            │   lookup        │
└─────────────────┘            └─────────────────┘
```

---

## Technical Implementation

### 1. Create ShareEstimateDialog Component

**New File:** `src/components/estimates/ShareEstimateDialog.tsx`

A dialog that collects:
- Recipient email (pre-filled from contact if available)
- Recipient name (pre-filled from contact)
- Custom email message (optional)
- Email subject (optional, with smart default)

On submit, invokes `send-quote-email` edge function which:
- Creates a tracking link in `quote_tracking_links`
- Sends a branded email via Resend with "View Your Quote" button
- Logs to `communication_history`

### 2. Add Share Button to EstimatePreviewPanel

**File:** `src/components/estimates/EstimatePreviewPanel.tsx`

Add to the Bottom Actions section (alongside Export PDF):
- Share icon button that opens the ShareEstimateDialog
- Pass required props: estimateId, contactId, customerEmail, customerName

**UI Change:**
```
┌────────────────────────────────────┐
│ [Reset Defaults]                   │
│ [Share]  [Export PDF]              │  ← Two buttons side by side
└────────────────────────────────────┘
```

### 3. Update EstimatePreviewPanel Props

Need to add these props to enable sharing:
- `estimateId: string` - The database estimate ID
- `contactId?: string` - The associated contact ID
- `pipelineEntryId?: string` - For logging

### 4. Enhance track-quote-view Edge Function for SMS

**File:** `supabase/functions/track-quote-view/index.ts`

Add SMS notification logic after creating the view event:

```typescript
// Get rep's phone number
const { data: repProfile } = await supabase
  .from("profiles")
  .select("phone, first_name")
  .eq("id", trackingLink.sent_by)
  .single();

// Send SMS notification if rep has phone
if (repProfile?.phone) {
  const viewCount = (trackingLink.view_count || 0) + 1;
  const viewText = viewCount === 1 ? "just opened" : `viewed again (${viewCount}x)`;
  
  const smsMessage = `🔔 ${contactName} ${viewText} your quote #${estimate_number}!${geo.city ? ` From ${geo.city}` : ''}`;
  
  // Call telnyx-send-sms internally
  await fetch(`${supabaseUrl}/functions/v1/telnyx-send-sms`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: repProfile.phone,
      message: smsMessage,
      // Use service account context for internal calls
    })
  });
}
```

**Key Feature:** SMS sent on EVERY view (not just first), with view count included.

---

## Database Requirements

No new tables needed - uses existing:
- `quote_tracking_links` - Stores tracking tokens and view counts
- `quote_view_events` - Records each view with device/location info
- `communication_history` - Logs outbound emails
- `user_notifications` - In-app notifications (existing behavior)

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/estimates/ShareEstimateDialog.tsx` | Share dialog with email form |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/EstimatePreviewPanel.tsx` | Add Share button, import dialog, add props |
| `supabase/functions/track-quote-view/index.ts` | Add SMS notification to rep on view |

---

## Props Flow Update

Since `EstimatePreviewPanel` doesn't currently receive `estimateId` or `contactId`, we need to update the component hierarchy:

**MultiTemplateSelector.tsx** already has:
- `pipelineEntryId` 
- Access to saved estimate ID

Need to pass down:
- `estimateId` (from saved estimate)
- `contactId` (from pipeline_entry contact lookup)

---

## User Experience

1. **Rep creates/views estimate preview**
2. **Clicks "Share" button** → Dialog opens
3. **Enters recipient email** (pre-filled if contact has email)
4. **Clicks "Send"** → Email dispatched with tracking link
5. **Customer receives email** → Clicks "View Your Quote"
6. **Customer views estimate** → Rep instantly gets SMS: 
   > "🔔 Nicole Walker just opened your quote #EST-2026-001! From Dallas, TX"
7. **Customer reopens later** → Rep gets another SMS:
   > "🔔 Nicole Walker viewed again (3x) your quote #EST-2026-001!"

---

## Security Considerations

- Tracking tokens are UUID-based and hashed in database
- SMS only sent to verified rep phone in their profile
- Email sent via Resend with proper authentication
- View tracking respects link expiration (30 days default)

---

## Expected Outcome

- Reps get instant SMS alerts when customers engage with quotes
- Enables timely follow-up calls while customer is actively reviewing
- View count shows customer interest level
- All communication logged for audit trail
