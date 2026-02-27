

# Add "My Dialer Number" (Rep Callback Number) to Call Center + Settings

## What This Is

The dialer needs a **bridge-call architecture** like Mojo Dialer: the company's Telnyx number calls the rep's personal phone first, then cycles through leads by bridging each one to the rep's live line. The rep stays on one continuous call while leads rotate in and out.

Right now there's nowhere for the rep to enter their personal phone number that the system calls to initiate the session.

## Changes

### 1. Store per-user callback number in `app_settings`

Key: `dialer_callback_number`, scoped to `user_id` + `tenant_id`. Value: `{ phone: "+1XXXXXXXXXX" }`.

No migration needed — `app_settings` already supports arbitrary keys with `user_id`.

### 2. Add "My Dialer Number" input to `DialerSettings.tsx`

New card below the Outbound Caller ID section:
- **"My Dialer Number"** — Input field where the rep enters their personal cell/desk phone
- Description: "The dialer will call this number first to connect you, then cycle through leads on your line."
- Save button persists to `app_settings` with key `dialer_callback_number`
- Shows current saved number with a "Change" option

### 3. Add callback number input to `CallCenterPage.tsx` header

Next to the caller ID selector and Start Dialer button:
- Small input/display showing the rep's saved callback number
- If no number is saved, "Start Dialer" shows a prompt to enter one first
- Editable inline — changes save to `app_settings` immediately

### 4. Update `telnyx-dial` to support bridge mode

Add a new edge function `telnyx-bridge-dial` that:
1. Calls the rep's callback number using the selected location's Telnyx number
2. When rep answers (webhook event `call.answered`), stores the `call_control_id` for the rep leg
3. Calls the first lead's number
4. When lead answers, bridges both legs via Telnyx `bridge` command
5. When lead hangs up, the rep leg stays alive — the system calls the next lead and bridges again

The existing `telnyx-dial` stays as-is for quick calls. The new function handles the persistent bridge flow.

### 5. Pass callback number through `CallCenterLiveDialer`

Add `callbackNumber` prop. When `handleCall` fires, it invokes `telnyx-bridge-dial` instead of `telnyx-dial`, passing the rep's callback number + location caller ID + contact info.

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/telnyx-bridge-dial/index.ts` | Bridge-call initiation: calls rep first, then bridges to lead |

## Files to Modify

| File | Change |
|------|--------|
| `src/components/call-center/DialerSettings.tsx` | Add "My Dialer Number" card with phone input + save |
| `src/pages/CallCenterPage.tsx` | Add callback number display/edit in header, validate before Start Dialer, pass to live dialer |
| `src/components/call-center/CallCenterLiveDialer.tsx` | Accept `callbackNumber` prop, invoke `telnyx-bridge-dial` instead of `telnyx-dial` |

