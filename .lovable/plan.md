
# Plan: Add Share Button with Tracked Email and SMS Notifications

## Status: ✅ COMPLETED

## Overview

Add a "Share" button to the Estimate Preview Panel that sends a trackable email to the customer. When the customer opens and views the estimate, the sales rep receives an SMS text notification to their phone - both on initial open AND every subsequent reopen.

---

## Implementation Summary

### Completed Tasks:

1. ✅ **Created ShareEstimateDialog Component**
   - File: `src/components/estimates/ShareEstimateDialog.tsx`
   - Collects recipient email, name, optional subject, and custom message
   - Pre-fills from contact info when available
   - Invokes `send-quote-email` edge function
   - Shows success state with confirmation message

2. ✅ **Added Share Button to EstimatePreviewPanel**
   - File: `src/components/estimates/EstimatePreviewPanel.tsx`
   - Added Share button next to Export PDF button
   - Added new props: `estimateId`, `contactId`
   - Button is disabled until estimate is saved (needs estimateId)

3. ✅ **Updated MultiTemplateSelector**
   - File: `src/components/estimates/MultiTemplateSelector.tsx`
   - Added `contactId` state
   - Fetches `contact_id` from pipeline_entries
   - Passes `estimateId` and `contactId` to EstimatePreviewPanel

4. ✅ **Enhanced track-quote-view Edge Function**
   - File: `supabase/functions/track-quote-view/index.ts`
   - Sends SMS notification to rep on EVERY view (not just first)
   - Includes view count in message (e.g., "viewed again (3x)")
   - Includes location if available (e.g., "From Dallas")
   - Non-blocking: SMS failure doesn't break view tracking

---

## User Experience Flow

1. Rep creates/views estimate preview
2. Clicks "Share" button → Dialog opens
3. Enters recipient email (pre-filled if contact has email)
4. Clicks "Send" → Email dispatched with tracking link
5. Customer receives email → Clicks "View Your Quote"
6. Customer views estimate → Rep instantly gets SMS: 
   > "🔔 Nicole Walker just opened quote #EST-12345678! From Dallas"
7. Customer reopens later → Rep gets another SMS:
   > "🔔 Nicole Walker viewed again (3x) quote #EST-12345678!"

---

## Files Modified/Created

| File | Action |
|------|--------|
| `src/components/estimates/ShareEstimateDialog.tsx` | Created |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Modified |
| `src/components/estimates/MultiTemplateSelector.tsx` | Modified |
| `supabase/functions/track-quote-view/index.ts` | Modified |

