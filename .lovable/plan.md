

# Fix: Remove Non-Existent Columns from `signer-open` Edge Function

## Problem

The latest deploy fixed the `recipient_name`/`recipient_email` columns, but two more non-existent columns remain:

1. **`signature_envelopes.message`** -- does not exist in the database. The SELECT query on line 81 crashes with error 42703, returning "Envelope not found" to the frontend.
2. **`signature_recipients.viewed_at`** -- does not exist. The UPDATE on line 117 will fail silently or error when marking first view.

## Changes

### File: `supabase/functions/signer-open/index.ts`

**1. Remove `message` from the envelope SELECT query (line 81)**

Remove the `message,` line from the select statement (lines 73-83).

**2. Remove `message` from the response payload (line 188)**

Change `message: envelope.message,` to remove it entirely (or set it to `null`/empty string if the frontend expects the field).

**3. Remove `viewed_at` from the recipient UPDATE (line 117)**

Remove the `viewed_at: new Date().toISOString(),` line since that column doesn't exist. The status change to `'viewed'` is sufficient.

After these fixes, all column references will match the actual database schema and both Chris's and Taylor's existing links will work immediately.
