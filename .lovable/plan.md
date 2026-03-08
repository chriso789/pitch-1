

# Complete the Power Dialer: Bridge Call Architecture

## Current State

The system has two dialer UIs (old `Dialer.tsx` + newer `CallCenterPage.tsx` with `CallCenterLiveDialer`) and backend edge functions for both direct calls (`telnyx-dial`) and bridge calls (`telnyx-bridge-dial`). The Call Center page is the more complete implementation.

**What works:**
- `telnyx-bridge-dial`: Calls the rep's personal phone (callback number) using the location's Telnyx number — creates call record, sends call via Telnyx API
- `telnyx-call-webhook`: Handles `call.answered`, `call.hangup`, `call.recording.saved`, AMD events
- `CallCenterLiveDialer`: UI for list selection, caller ID, callback number, call/skip/disposition flow
- Location-based Telnyx phone numbers are provisioned and stored in `locations` table

**What's broken/missing:**
1. **Bridge leg 2 is never initiated** — When the rep answers the bridge call, the webhook gets `call.answered` but never dials the lead. The `client_state` contains `bridge_mode: true` and `lead_number`, but `telnyx-call-webhook` doesn't check for this and just updates status.
2. **No webhook URL passed to Telnyx** — Neither `telnyx-dial` nor `telnyx-bridge-dial` pass a `webhook_url` to `initiateCall()`, so Telnyx must rely on the connection-level webhook setting. If that's not configured, no events are received.
3. **Call hangup from UI doesn't actually hang up Telnyx** — `CallCenterLiveDialer` only updates the DB record on hangup; it doesn't send a Telnyx Call Control hangup command.

## Plan

### 1. Update `telnyx-call-webhook` to handle bridge leg 2

When `call.answered` fires and `client_state.bridge_mode === true`:
- Extract `lead_number` from client_state
- Use Telnyx Call Control API to **transfer** the rep's call to the lead number (using `call_control_id` + Telnyx transfer endpoint), OR initiate a second call and bridge them
- The simplest approach: use Telnyx's `transfer` command on the answered call to connect to the lead

```
POST https://api.telnyx.com/v2/calls/{call_control_id}/actions/transfer
{ "to": lead_number }
```

This connects the rep to the lead on the same call session.

### 2. Pass webhook URL in both dial functions

Update `telnyx-bridge-dial` and `telnyx-dial` to include `webhook_url` pointing to the `telnyx-call-webhook` edge function:

```ts
const webhookUrl = `${ENV.SUPABASE_URL}/functions/v1/telnyx-call-webhook`;
```

### 3. Add hangup edge function call from UI

Create a new edge function `telnyx-hangup` (or add to `telnyx-call-webhook` as an action) that sends:
```
POST https://api.telnyx.com/v2/calls/{call_control_id}/actions/hangup
```

Update `CallCenterLiveDialer.handleHangup` to call this function using the `telnyx_call_control_id` stored on the call record.

### 4. Wire mute/unmute through Telnyx Call Control

Similarly, the mute button in the UI currently only toggles local state. Add call control commands for mute/unmute.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/telnyx-call-webhook/index.ts` | Add bridge transfer logic on `call.answered` when `bridge_mode` is true |
| `supabase/functions/telnyx-bridge-dial/index.ts` | Pass `webhook_url` to `initiateCall()` |
| `supabase/functions/telnyx-dial/index.ts` | Pass `webhook_url` to `initiateCall()` |
| `supabase/functions/telnyx-hangup/index.ts` | **New** — sends hangup command via Call Control API |
| `supabase/config.toml` | Add `telnyx-hangup` function config |
| `src/components/call-center/CallCenterLiveDialer.tsx` | Call `telnyx-hangup` on hang up; call mute/unmute endpoints |

