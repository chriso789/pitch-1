

# Fix: Move Duplicate Leads from East Coast to West Coast

## Problem Summary

3 contacts that belong to **West Coast** were accidentally imported into **East Coast**, creating duplicate pipeline entries. One of them (Henry Germann) has an estimate worth $68,788 that needs to be preserved.

## Current Situation

| Contact | East Coast Entry | West Coast Entry | East Coast Work |
|---------|------------------|------------------|-----------------|
| **Henry Germann** | CLJ 3329-1-0 | CLJ 3318-1-0 | **1 estimate ($68,788)** |
| Irina Gorovits | CLJ 3331-1-0 | CLJ 3320-1-0 | None |
| James White | CLJ 3330-1-0 | CLJ 3324-1-0 | None |

## Solution

Since the West Coast entries are the **originals** (created first at 03:24), we will:
1. **Move Henry Germann's estimate** from the East Coast entry to the West Coast entry
2. **Soft-delete all 3 East Coast duplicate entries** (keep West Coast as the authoritative record)

---

## SQL Script to Run in Supabase SQL Editor

**Run this in the [SQL Editor](https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/sql/new):**

```sql
-- Step 1: Move Henry Germann's estimate from East Coast to West Coast entry
UPDATE enhanced_estimates 
SET pipeline_entry_id = '9b56de04-684b-4995-aa5b-d2642fdebbf1'  -- West Coast Henry Germann
WHERE pipeline_entry_id = 'c97b5e9e-6a89-4ee5-bebc-405c7fa923a9' -- East Coast Henry Germann
  AND id = 'e500a7f1-9482-4557-89b7-a6bf98aaf8db';  -- Estimate OBR-00023-gsjc

-- Step 2: Soft-delete all 3 East Coast duplicate pipeline entries
UPDATE pipeline_entries 
SET is_deleted = true
WHERE id IN (
  'c97b5e9e-6a89-4ee5-bebc-405c7fa923a9',  -- Henry Germann (East Coast duplicate)
  '9e61c71f-1c54-4149-a3c9-acc964de52a0',  -- Irina Gorovits (East Coast duplicate)
  'ad5481e3-3e0d-4e2b-b762-fbdfc7e8d30e'   -- James White (East Coast duplicate)
);

-- Verify the changes
SELECT 
  'Henry Germann estimate moved' as action,
  ee.estimate_number,
  ee.selling_price,
  pe.clj_formatted_number,
  l.name as location
FROM enhanced_estimates ee
JOIN pipeline_entries pe ON ee.pipeline_entry_id = pe.id
JOIN locations l ON pe.location_id = l.id
WHERE ee.id = 'e500a7f1-9482-4557-89b7-a6bf98aaf8db';
```

---

## Expected Result After Running Script

| Contact | Pipeline Entry | Location | Status |
|---------|----------------|----------|--------|
| Henry Germann | CLJ 3318-1-0 | **West Coast** | Has $68,788 estimate ✓ |
| Irina Gorovits | CLJ 3320-1-0 | **West Coast** | Active ✓ |
| James White | CLJ 3324-1-0 | **West Coast** | Active ✓ |

**East Coast pipeline will no longer show these 3 contacts** (they'll be correctly in West Coast only).

---

## No Code Changes Required

This is purely a **data correction**. The prevention code for future imports has already been added in the previous update to `ContactBulkImport.tsx`.

