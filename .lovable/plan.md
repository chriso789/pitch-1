

# Fix: Call Hanging Up After 2 Rings

## Root Cause

Two issues causing premature hangup on the **rep leg**:

1. **Answering Machine Detection (AMD) on the rep leg**: The frontend sends `answering_machine_detection: 'premium'` to `telnyx-bridge-dial`. This causes Telnyx to analyze the rep's ringing/answer and may terminate the call early thinking it's a machine. **AMD should NOT be applied to the rep leg** — it's meant for the lead leg only.

2. **No `timeout_secs` parameter**: The `initiateCall()` function doesn't pass a `timeout_secs` to Telnyx. Without it, Telnyx may use a short default ring timeout, especially when AMD is active.

Evidence from logs: `call.initiated` → `call.hangup` (~10 seconds, no `call.answered`). The call never connects because Telnyx terminates it during ringing.

## Changes

### 1. `telnyx-bridge-dial/index.ts` — Strip AMD from the rep leg
- Remove the `answering_machine_detection` parameter from the `initiateCall()` call for bridge mode
- Add `timeout_secs: 60` so the rep has a full minute to pick up
- Store the AMD preference in `client_state` so it can be applied later on the lead leg (during transfer)

### 2. `_shared/telnyx.ts` — Add `timeout_secs` support
- Add optional `timeout_secs` field to `TelnyxDialParams`
- Pass it through in `initiateCall()` when provided

### 3. `telnyx-call-webhook/index.ts` — Apply AMD on the lead transfer
- In the `call.gather.ended` handler (when rep presses 9), pass `answering_machine_detection` from `client_state` to the transfer command so AMD runs on the lead's phone instead

## Flow After Fix
```text
Rep clicks Call → bridge-dial calls rep (NO AMD, 60s timeout)
  → Rep answers → "Press 9 to connect"
  → Rep presses 9 → Transfer to lead (WITH AMD + recording)
  → Lead answers → conversation recorded
```

## Files Modified
- `supabase/functions/_shared/telnyx.ts` — add `timeout_secs` to dial params
- `supabase/functions/telnyx-bridge-dial/index.ts` — remove AMD, add timeout, store AMD pref in client_state
- `supabase/functions/telnyx-call-webhook/index.ts` — apply AMD on lead transfer leg

