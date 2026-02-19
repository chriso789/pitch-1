
# Fix: Signed Estimate Not Updating Status, Documents, or Sending Emails

## Root Cause (from live error logs)

The `finalize-envelope` edge function crashes immediately because it references **wrong column names**:

```
ERROR: column signature_recipients.name does not exist
```

This means after a signature is captured:
- The signed PDF is never generated (no signature embedded on the estimate)
- No document record is created in the Documents tab
- No completion email is sent to the client or rep
- The estimate status is never updated to "signed"

## All Issues Found

### Issue 1: `finalize-envelope/index.ts` -- Wrong column names (CRITICAL)
The function queries `name` and `email` but the actual columns are `recipient_name` and `recipient_email`.

**Lines 64-67:** Change `.select('id, name, email, status, signed_at')` to `.select('id, recipient_name, recipient_email, status, signed_at')`

Then update ALL references throughout the function:
- `r.name` becomes `r.recipient_name`
- `r.email` becomes `r.recipient_email`

This affects ~8 places in the file (recipient names in document records, certificate page, email collection, etc.)

### Issue 2: `finalize-envelope/index.ts` -- No estimate status update
When the envelope is linked to an `enhanced_estimate`, the status should be set to `signed`. Currently only the old `capture-digital-signature` function does this, but the active signing flow uses `submit-signature` -> `finalize-envelope` which skips it entirely.

**Add after envelope completion (around line 417):** Query `enhanced_estimates` by `signature_envelope_id`, and if found, update its `status` to `signed` and set `signed_at`.

### Issue 3: `submit-signature/index.ts` -- Wrong notification columns
The `createNotification` call passes `action_url` and `priority` which don't exist on `user_notifications`. These should be removed or placed inside `metadata`.

**Lines 169-184:** Remove `action_url` and `priority` from the notification insert, or move them into the `metadata` JSONB field.

### Issue 4: `finalize-envelope/index.ts` -- Wrong notification columns
Same problem -- `createNotification` likely passes `action_url` which doesn't exist.

**Lines 449-463:** Same fix as Issue 3.

## Files to Change

### 1. `supabase/functions/finalize-envelope/index.ts`
- Fix column names: `name` -> `recipient_name`, `email` -> `recipient_email` (lines 66, and all downstream references on lines ~239, 252, 390, 422, 505-507, 555-556)
- Add estimate status update block after envelope completion (~line 417)
- Fix `createNotification` call to remove `action_url`/`priority`

### 2. `supabase/functions/submit-signature/index.ts`
- Fix `createNotification` call to remove `action_url` and `priority` (lines 169-184)

### 3. `supabase/functions/_shared/utils.ts` (if needed)
- Verify `createNotification` helper matches the actual `user_notifications` schema

## What This Fixes

- Estimate status in "Saved Estimates" will update to "signed" after customer signs
- Signed PDF (with embedded signature + certificate page) will be saved to the Documents tab
- Completion emails will be sent to both the client and the sales rep with a download link
- In-app notifications will work without database errors
