
# Plan: Fix Edge Functions for Share Estimate Feature

## Problem Identified

The "Share Estimate" feature is failing with "Edge Function returned a non-2xx status code" because:

1. **Wrong Table Name**: The `send-quote-email` edge function queries the `estimates` table (line 78), but the application actually stores estimates in `enhanced_estimates`
2. **Column Mismatch**: The `estimates` table has different columns than `enhanced_estimates`, causing lookup failures

## Root Cause

```typescript
// Current (WRONG) - in send-quote-email/index.ts
const { data: estimate } = await supabase
  .from("estimates")  // ❌ Wrong table
  .select("*, pipeline_entries(id, lead_number)")
  .eq("id", body.estimate_id)
  .single();
```

The code was written with a placeholder table name, but all estimate operations in the frontend use `enhanced_estimates`.

---

## Solution

### 1. Update send-quote-email Edge Function

**File:** `supabase/functions/send-quote-email/index.ts`

Change the table from `estimates` to `enhanced_estimates` and update the select query to match the actual schema:

**Before (line 77-81):**
```typescript
const { data: estimate } = await supabase
  .from("estimates")
  .select("*, pipeline_entries(id, lead_number)")
  .eq("id", body.estimate_id)
  .single();
```

**After:**
```typescript
const { data: estimate } = await supabase
  .from("enhanced_estimates")
  .select("id, estimate_number, selling_price, pipeline_entry_id, pipeline_entries(id, lead_number)")
  .eq("id", body.estimate_id)
  .single();
```

### 2. Update track-quote-view Edge Function

**File:** `supabase/functions/track-quote-view/index.ts`

The tracking link references `estimate_id` which links to `enhanced_estimates`. Update the join to use the correct table:

**Before (line 82-101):**
```typescript
const { data: trackingLink } = await supabase
  .from("quote_tracking_links")
  .select(`
    *,
    estimates (
      id,
      estimate_number,
      selling_price,
      pipeline_entry_id
    ),
    ...
  `)
```

**After:**
```typescript
const { data: trackingLink } = await supabase
  .from("quote_tracking_links")
  .select(`
    *,
    enhanced_estimates (
      id,
      estimate_number,
      selling_price,
      pipeline_entry_id
    ),
    ...
  `)
```

Also update all references from `trackingLink.estimates` to `trackingLink.enhanced_estimates`:
- Line 137: `trackingLink.estimates?.estimate_number` → `trackingLink.enhanced_estimates?.estimate_number`
- Line 138: `trackingLink.estimates?.selling_price` → `trackingLink.enhanced_estimates?.selling_price`
- Line 216: `trackingLink.estimates?.estimate_number` → `trackingLink.enhanced_estimates?.estimate_number`
- Line 238: `trackingLink.estimates?.estimate_number` → `trackingLink.enhanced_estimates?.estimate_number`

### 3. Verify quote_tracking_links Foreign Key

Ensure the `estimate_id` column in `quote_tracking_links` correctly references `enhanced_estimates`:

```sql
-- Check current FK
SELECT 
  tc.table_name, 
  kcu.column_name, 
  ccu.table_name AS foreign_table_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'quote_tracking_links' 
  AND tc.constraint_type = 'FOREIGN KEY';
```

If the FK points to wrong table, migration may be needed.

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/send-quote-email/index.ts` | Change `estimates` → `enhanced_estimates` table query |
| `supabase/functions/track-quote-view/index.ts` | Change `estimates` → `enhanced_estimates` in join, update all field references |

---

## Testing After Fix

1. Open an existing saved estimate
2. Click "Share" button
3. Enter recipient details
4. Click "Send Quote"
5. Verify email is sent successfully
6. Test the tracking link received in email
7. Confirm SMS notification is sent to rep when link is opened

---

## Expected Outcome

- Share button successfully sends trackable quote emails
- Tracking links work correctly
- SMS notifications fire when customers view quotes
