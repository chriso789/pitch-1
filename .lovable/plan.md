

# Add DTMF Confirmation Prompt + Fix Recording on Bridge Calls

## Two Issues

### 1. No confirmation prompt before bridging
Currently, when the rep answers their phone, the webhook immediately transfers to the lead. The rep needs a "Press 9 to start calling" gate so they can confirm readiness.

### 2. Recordings not saving
The `record: 'record-from-answer'` parameter is passed on the initial call to the rep's phone. However, when the call is **transferred** to the lead via `call.answered`, the transfer command doesn't include a `record` parameter -- so Telnyx stops recording on the new leg. The recording needs to be explicitly started on the bridged leg.

## Changes

### A. Webhook: Replace immediate transfer with gather (DTMF prompt)
In `telnyx-call-webhook/index.ts`, when `call.answered` fires in bridge mode:

- Instead of immediately calling `/actions/transfer`, call `/actions/gather` with:
  - `audio_url` pointing to a TTS or pre-recorded prompt ("Press 9 to connect to your next lead")
  - `valid_digits: "9"`
  - `timeout_millis: 15000`
  - Pass `client_state` through so the gather response correlates back
- Update call status to `awaiting_confirmation` instead of `bridging`

### B. Webhook: Handle `call.gather.ended` event
Add a new case in the webhook switch:

- When `call.gather.ended` fires:
  - Check if the digit pressed is `"9"`
  - If yes: initiate the transfer to the lead number (same logic currently in `call.answered`)
  - Also send a `/actions/record_start` command on the call to ensure recording captures the bridged conversation
  - If no/timeout: hang up the call and mark it as `no_confirmation`

### C. Webhook: Use `call.speak.started` instead of `audio_url` (simpler)
Since we may not have a hosted audio file, use Telnyx's `/actions/speak` + `/actions/gather` combo:

- On `call.answered` (bridge mode): call `/actions/gather` with `speak` payload using Telnyx TTS: "Press 9 to connect to your next lead"
- This avoids needing to host an audio file

### D. Fix recording on transfer
In the transfer command (now inside `call.gather.ended`):
- After initiating transfer, send `/actions/record_start` with `format: 'mp3'` and `channels: 'dual'`
- This ensures the bridged conversation is recorded
- Alternative: pass `record: 'record-from-answer'` in the transfer body if Telnyx supports it

## Flow After Fix
```text
Rep clicks "Call"
  → telnyx-bridge-dial calls rep's phone
  → Rep answers → webhook: call.answered
  → Webhook sends gather+speak: "Press 9 to connect"
  → Rep presses 9 → webhook: call.gather.ended
  → Webhook transfers to lead + starts recording
  → Lead answers → conversation recorded
  → call.hangup → recording saved to DB
```

## Files Modified
- `supabase/functions/telnyx-call-webhook/index.ts` -- add gather prompt on answer, handle `call.gather.ended`, start recording on bridge

## No Frontend Changes Required
The UI already handles the call states. The `awaiting_confirmation` status is cosmetic and will show as "in-progress" in the call log.

