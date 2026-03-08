

# Fix: Quick Call Failing — Column Name Mismatch

## Problem

The edge function `telnyx-dial` inserts `user_id` into the `calls` table, but the actual column is named `created_by`. This causes:
```
Could not find the 'user_id' column of 'calls' in the schema cache
```

## Fix

**File:** `supabase/functions/telnyx-dial/index.ts`

Change the insert at line 165 from `user_id: user.id` to `created_by: user.id`.

Also update the `client_state` encoding (line 189) to use `created_by` for consistency, though the webhook reads it as `user_id` from client_state JSON (which is fine since that's not a DB column reference).

This is a one-line fix that will unblock all outbound calling.

