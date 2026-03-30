

## Diagnosis: Text Blasts Failing — "Not 10DLC registered"

### Root Cause

The SMS messages ARE being sent to Telnyx successfully (API accepts them), but **carriers are rejecting delivery** with error code **40010: "Not 10DLC registered"**.

**10DLC (10-Digit Long Code)** is a US carrier requirement (enforced by AT&T, T-Mobile, Verizon) that requires businesses to register their phone numbers and brand before sending application-to-person (A2P) SMS. Unregistered numbers get their messages silently dropped or rejected.

Your Telnyx number `+19415410117` is not registered with the 10DLC campaign registry, so carriers are blocking all outbound SMS from it.

### This is NOT a code bug — it's a carrier compliance issue

The code is working correctly:
- Blast processor runs fine
- Telnyx API accepts the message
- Carrier rejects delivery post-acceptance
- Status webhook correctly updates the record to "failed" with the error

### What You Need to Do (in Telnyx portal)

1. **Log into your Telnyx account** at portal.telnyx.com
2. Go to **Messaging → 10DLC** (or Brand Registration)
3. **Register your brand** (company name, EIN, business type)
4. **Create a 10DLC campaign** (describe the use case: "CRM notifications and customer communications for construction company")
5. **Assign your phone number(s)** to the approved campaign
6. Approval typically takes 1-5 business days

### Secondary Code Fix (non-blocking)

There is also a minor code issue: the `telnyx-send-sms` function inserts `sms_messages` with status `'queued'`, but the database check constraint only allows `pending`, `sent`, `delivered`, `failed`, `received`. This causes the thread message insert to fail silently. I'll fix this by changing `'queued'` to `'pending'` in the insert.

### Plan

**File: `supabase/functions/telnyx-send-sms/index.ts`** (line 383)
- Change `status: 'queued'` to `status: 'sent'` in the `sms_messages` insert

Then redeploy `telnyx-send-sms`.

**But the primary fix is 10DLC registration in the Telnyx portal — no code change can bypass carrier enforcement.**

