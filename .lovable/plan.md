

# Fix Duplicate Leads in Pipeline

## Root Cause

The pipeline isn't showing the same lead twice -- it's showing **separate leads tied to duplicate contact records**. For example:
- Henry Germann has 6 contact records in the database (all same phone/address), with 2 active pipeline entries
- Irina Gorovits has 8+ contact records, with 3 active pipeline entries

The lead creation functions (`create-lead-with-contact` and `external-lead-webhook`) create a **new contact every time** without checking if one already exists with the same phone number or email.

## Solution: Two-Part Fix

### Part 1: Prevent Future Duplicates

**File: `supabase/functions/create-lead-with-contact/index.ts`**

Before creating a new contact, check for existing contacts matching by phone number (primary identifier in construction CRM) within the same tenant:

```
-- Lookup logic (pseudocode):
1. Normalize incoming phone number
2. Query contacts WHERE tenant_id = X AND phone = normalized_phone
3. If match found, use existing contact_id instead of creating new
4. Still create the pipeline entry linked to the existing contact
```

**File: `supabase/functions/external-lead-webhook/index.ts`**

Same deduplication check before contact creation -- match on phone or email within the tenant.

### Part 2: Clean Up Existing Duplicates

Provide a SQL cleanup approach to merge duplicate contacts:
1. Identify duplicates by matching phone number within each tenant
2. Keep the oldest contact record (lowest contact_number) as the primary
3. Re-link pipeline entries from duplicate contacts to the primary contact
4. Soft-delete the duplicate contact records

This will be done carefully with a review query first so you can verify before any data changes.

## Technical Details

### Edge Function Changes

**`create-lead-with-contact/index.ts`** (around line 300-380):

Add contact lookup before the insert block:
- Normalize phone (strip non-digits)
- Query `contacts` table for matching `phone` + `tenant_id`
- If found, skip contact creation and use existing `contact_id`
- Optionally update the existing contact with any new info (email, address) that wasn't previously set

**`external-lead-webhook/index.ts`** (around line 240-310):

Same pattern -- check for existing contact by phone/email before inserting a new one.

### Data Cleanup Query (run manually)

Step 1 -- Review duplicates (read-only):
```sql
SELECT phone, tenant_id, COUNT(*) as dupes,
       array_agg(id ORDER BY created_at) as contact_ids
FROM contacts
WHERE phone IS NOT NULL AND phone != ''
GROUP BY phone, tenant_id
HAVING COUNT(*) > 1;
```

Step 2 -- After review, re-link pipeline entries to the primary (oldest) contact and soft-delete duplicates. This will be provided as a safe, reversible migration.

## Files Modified

1. `supabase/functions/create-lead-with-contact/index.ts` -- Add contact dedup lookup
2. `supabase/functions/external-lead-webhook/index.ts` -- Add contact dedup lookup

## Impact

- Prevents new duplicate contacts from being created
- Existing duplicates cleaned up via SQL
- Pipeline will show each real person only once per property/lead

