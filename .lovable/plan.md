

# Fix: Wrong Caller ID + Call Hangup — Root Cause Found

## Root Cause

The `locations` table has **no column named `telnyx_connection_id`**. The actual column is `telnyx_voice_app_id`. Both `telnyx-bridge-dial` and `telnyx-dial` edge functions query `telnyx_connection_id`, which causes PostgREST to return an error. This makes every location lookup fail silently, so:

- `fromNumber` falls back to `ENV.TELNYX_PHONE_NUMBER` = `+12399194485` (the 239 number) instead of the East Coast location's `+15613144201`
- `connectionId` falls back to `ENV.TELNYX_CONNECTION_ID` (which may or may not be correct)

This is why the caller ID always shows the 239 number regardless of which location is selected.

The call hanging up instantly is likely related to the webhook not being properly deployed with the DTMF logic, or a Telnyx connection issue. The webhook logs show only `call.initiated` → `call.hangup` with no `call.answered` in between (8 seconds total).

## Changes

### 1. Fix `telnyx-bridge-dial/index.ts` — Use correct column name
Replace all three location queries to select `telnyx_voice_app_id` instead of `telnyx_connection_id`. Map the result to `connectionId` from the correct column.

### 2. Fix `telnyx-dial/index.ts` — Same column fix
Same change in all three location lookup queries.

### 3. Fix `telnyx-call-webhook/index.ts` — Ensure DTMF gate works
The bridge_mode check on line 65 compares `clientState.bridge_mode` against the string `'true'`. Since the bridge-dial encodes `bridge_mode: true` (boolean), when decoded from JSON it's a boolean. The current check `=== 'true'` would fail for a real boolean. Fix to handle both.

### 4. Redeploy all three edge functions
Deploy `telnyx-bridge-dial`, `telnyx-dial`, and `telnyx-call-webhook` together.

## Technical Detail
```text
locations table columns (relevant):
  telnyx_phone_number        ← exists ✅
  telnyx_voice_app_id        ← exists ✅ (this is the connection ID)
  telnyx_connection_id       ← DOES NOT EXIST ❌

Current queries select telnyx_connection_id → PostgREST 400 → fallback to ENV
Fix: select telnyx_voice_app_id instead
```

