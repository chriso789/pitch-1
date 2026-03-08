

# Fix DTMF Prompt Deployment + Caller ID on Bridge Calls

## Issues Found

1. **DTMF prompt not working**: The webhook logs still show the old "transferring to lead" message, meaning the updated `telnyx-call-webhook` with gather/speak was never deployed. It needs to be redeployed.

2. **Caller ID shows 239-919-4485**: The `initiateCall()` helper in `_shared/telnyx.ts` only passes `from` to Telnyx, but does **not** pass `caller_id_number`. Telnyx uses the connection's default caller ID instead of the `from` number. The fix is to explicitly set `caller_id_number` in the Telnyx API call body.

3. **Recording not saving**: Related to issue #1 — the `record_start` command added in `call.gather.ended` was never deployed either. Additionally, the initial `record: 'record-from-answer'` on the rep leg may not carry over to the transferred leg. The deployed gather+record_start fix will address this.

## Changes

### A. Update `_shared/telnyx.ts` — Add `caller_id_number` support
- Add optional `caller_id_number` field to `TelnyxDialParams` interface
- Pass it through in the `initiateCall()` function body when provided

### B. Update `telnyx-bridge-dial/index.ts` — Pass `caller_id_number`
- When calling `initiateCall()`, add `caller_id_number: formattedFrom` so the rep's phone displays the Telnyx number, not the 239 number
- Also store `from_number` in the `clientState` so the webhook can use it for the transfer's `from` field

### C. Redeploy `telnyx-call-webhook/index.ts`
- The gather/speak DTMF code is already in the file — it just needs redeployment
- Small fix: ensure `clientState` includes `from_number` for the transfer step so the lead also sees the Telnyx number as caller ID

## Flow After Fix
```text
Rep clicks Call → bridge-dial sends call to rep's phone
  → Caller ID shows Telnyx number (not 239)
  → Rep answers → webhook: call.answered
  → Gather+Speak: "Press 9 to connect"
  → Rep presses 9 → webhook: call.gather.ended
  → Transfer to lead + record_start
  → Lead sees Telnyx number as caller ID
  → Recording saves on hangup
```

## Files Modified
- `supabase/functions/_shared/telnyx.ts` — add `caller_id_number` to dial params
- `supabase/functions/telnyx-bridge-dial/index.ts` — pass `caller_id_number` and `from_number` in client state
- `supabase/functions/telnyx-call-webhook/index.ts` — use `from_number` from client state in transfer; redeploy triggers the gather/speak fix

