

# Fix: Column Name Mismatch in `signer-open` Edge Function

## Root Cause

The `signer-open` edge function is crashing with **`column signature_recipients.name does not exist`** (error code 42703). The function references columns `name`, `email`, and `routing_order`, but the actual database columns are `recipient_name`, `recipient_email`, and `signing_order`.

This is confirmed in the live edge function logs -- every request Chris makes hits this error immediately, returns a 404, and the frontend shows "Unable to Load."

## Changes

### File: `supabase/functions/signer-open/index.ts`

**1. Fix the SELECT query (lines 43-52)**

| Wrong column | Correct column |
|---|---|
| `name` | `recipient_name` |
| `email` | `recipient_email` |
| `routing_order` | `signing_order` |
| `viewed_at` | Remove (column does not exist -- use `status` to determine first view) |

**2. Fix all references to `recipient.name` and `recipient.email` throughout the file**

Every place that uses `recipient.name` must become `recipient.recipient_name`, and `recipient.email` must become `recipient.recipient_email`. This affects:

- Line 128: notification message
- Line 134-135: notification metadata
- Line 150: audit log metadata
- Line 195-196: response payload

**3. Fix first-view detection (line 111)**

Since `viewed_at` doesn't exist, determine first view by checking `recipient.status !== 'viewed'` and `recipient.status !== 'signed'` instead.

After these fixes, the edge function will query the correct columns, Chris's link will work immediately (no new link needed), and all previous unviewed signature links will also start working.
