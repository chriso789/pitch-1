

# Fix: Press 9 Not Registering — Root Cause Found

## Root Cause

The logs confirm the issue clearly:

```
[telnyx-call-webhook] Rep did not confirm (digits: ). Hanging up.
```

The rep pressed 9, but Telnyx returned **empty digits**. This happens because the webhook uses **two separate API calls** — `gather` then `speak` — which creates a race condition:

1. `gather` starts listening immediately (before any audio plays)
2. `speak` fires next, but the gather may have already timed out or the digit press doesn't register properly because the two commands are not synchronized

The `ai-project-status-answer` function in this same project uses `gather_using_speak` — a **single atomic command** that plays audio AND listens for digits simultaneously. This is the correct Telnyx pattern.

## Changes

### 1. `telnyx-call-webhook/index.ts` — Replace gather+speak with `gather_using_speak`

In the `call.answered` bridge mode block (lines 72-92), replace the two separate `gather` + `speak` calls with a single `gather_using_speak` call:

```typescript
await telnyxFetch(`/v2/calls/${callControlId}/actions/gather_using_speak`, {
  method: 'POST',
  body: JSON.stringify({
    payload: 'Press 9 to connect to your next lead.',
    voice: 'female',
    language: 'en-US',
    valid_digits: '9',
    maximum_digits: 1,
    minimum_digits: 1,
    timeout_secs: 15,
    client_state: payload.client_state,
  }),
});
```

### 2. Add retry on empty digits

In the `call.gather.ended` handler, when `digits` is empty and it's a bridge call, instead of hanging up, reprompt once using `gather_using_speak` again. Track retry via a `gather_retry` flag in client_state so it only retries once.

### 3. Redeploy `telnyx-call-webhook`

## Files Modified
- `supabase/functions/telnyx-call-webhook/index.ts`

