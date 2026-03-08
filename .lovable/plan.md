

# Fix Dialer to Use Bridge-Call Flow

## Problem
Currently, the Quick Call on `CallCenterPage` and `KanbanCard` call the lead's phone directly via `telnyx-dial`. The correct flow is:

1. System calls the **rep's callback number** first
2. Rep answers and the call is confirmed/connected
3. System then **bridges (transfers)** to the lead's number

The `telnyx-bridge-dial` edge function and the webhook bridge logic already exist and work correctly. The `CallCenterLiveDialer` component already uses bridge mode when a callback number is set. The problem is only in `CallCenterPage.handleQuickCall` and `KanbanCard.handleQuickCall` -- they bypass bridge mode entirely.

## Changes

### 1. Update `CallCenterPage.tsx` Quick Call handler
- Change `handleQuickCall` to use `telnyx-bridge-dial` instead of `telnyx-dial`
- Pull the user's `dialer_callback_number` from `app_settings` (already fetched on the page)
- If no callback number is set, prompt the user to set one before calling
- Pass the callback number and location_id to the bridge-dial function

### 2. Update `KanbanCard.tsx` Quick Call handler  
- Same change: use `telnyx-bridge-dial` with the rep's callback number
- Fetch callback number from `app_settings` or require it to be set
- Fall back to prompting the user if not configured

### 3. Verify webhook bridge logic
The webhook at `telnyx-call-webhook` already handles the `call.answered` event for bridge mode by transferring to the lead number. No changes needed there.

## Flow After Fix
```text
Rep clicks "Call" → telnyx-bridge-dial called
  → Telnyx calls rep's personal phone
  → Rep answers → webhook fires call.answered
  → Webhook sees bridge_mode=true → transfers to lead
  → Lead's phone rings → conversation begins
```

## Technical Notes
- The `dialer_callback_number` is already stored per-user in `app_settings` and the UI already has a "My Dialer Number" input on the Call Center page
- `CallCenterLiveDialer` already implements this correctly -- we're aligning the other call points to match

