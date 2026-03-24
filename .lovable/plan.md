

## Plan: Fix SMS Thread Visibility + Outbound Message Threading

### Problem Summary

Two issues are causing messages not to show in threads:

1. **Text Blast messages don't appear in SMS threads**: The `telnyx-send-sms` function (used by blast processor) writes to `communication_history` and updates `sms_threads` metadata, but **never inserts into `sms_messages`**. The thread UI (`SMSConversationThread`) reads from `sms_messages`, so blast-sent messages are invisible in conversation view.

2. **Delivery status webhook doesn't update `sms_messages`**: The `telnyx-sms-status-webhook` only updates `communication_history`. It does NOT update `sms_messages.delivery_status`, so even manually sent messages show stale status in the thread UI. (The `messaging-inbound-webhook` handles this for inbound, but the outbound status webhook does not.)

3. **SMS tab thread selection doesn't work on mobile**: The thread list and conversation are in a 2-column grid (`lg:grid-cols-2`), but on smaller screens both show `grid-cols-1` — the conversation panel is `overflow-hidden` with no mobile toggle to switch between list and thread view.

### Changes

#### 1. `supabase/functions/telnyx-send-sms/index.ts` — Insert `sms_messages` row

After the existing `communication_history` insert (line 305), also insert into `sms_messages` so the message appears in the thread conversation view. Include `provider_message_id` so delivery webhooks can find and update it.

#### 2. `supabase/functions/telnyx-sms-status-webhook/index.ts` — Also update `sms_messages`

After updating `communication_history`, also look up `sms_messages` by `provider_message_id` and update `delivery_status` + `error_message`. This is the same pattern already used in `messaging-inbound-webhook`'s `handleDeliveryStatusUpdate`.

#### 3. `src/pages/CommunicationsHub.tsx` + `SMSThreadList.tsx` — Mobile thread navigation

On mobile, when a thread is selected, show only the conversation (hide the list). Add a back button to return to the list. This requires:
- Track `selectedThread` state to conditionally show list vs thread on small screens
- On `< lg` breakpoints: show thread list when no thread selected, show conversation when thread selected
- The `SMSConversationThread` already has an `onBack` prop wired up

#### 4. `supabase/functions/telnyx-send-sms/index.ts` — Create thread if missing

Currently the function only updates existing threads but doesn't create new ones (line 326-342 only queries for existing). If no thread exists for the recipient phone number, create one — matching what `sms-send-reply` already does.

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/telnyx-send-sms/index.ts` | Insert `sms_messages` row + create thread if missing |
| `supabase/functions/telnyx-sms-status-webhook/index.ts` | Update `sms_messages.delivery_status` alongside `communication_history` |
| `src/pages/CommunicationsHub.tsx` | Mobile-responsive thread selection (show/hide list vs conversation) |

### Data Flow After Fix

```text
Outbound SMS (blast or direct):
  telnyx-send-sms → Telnyx API
    → INSERT communication_history (with message_id)
    → INSERT sms_messages (with provider_message_id)  ← NEW
    → UPSERT sms_threads (create if missing)          ← ENHANCED

Delivery webhook:
  Telnyx → telnyx-sms-status-webhook
    → UPDATE communication_history.delivery_status     (existing)
    → UPDATE sms_messages.delivery_status              ← NEW
```

