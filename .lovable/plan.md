

# Fix: Move Pipeline Entries to Correct Locations Based on City

## Problem Summary

Several pipeline entries are currently assigned to the wrong location. Based on Florida geography, entries need to be moved to their correct East Coast or West Coast locations.

## Location Classification

**West Coast FL (c490231c-2a0e-4afc-8412-672e1c890c16):**
- Bradenton, Sarasota, Venice, Englewood, Gulfport, Holmes Beach, Tampa, Lakeland, Land O' Lakes, St. Petersburg, North Port

**East Coast FL (a3615f0d-c7b7-4ee9-a568-a71508a539c6):**
- Boca Raton, Delray Beach, Miami Gardens, Riviera Beach, West Palm Beach

---

## Entries That Need to Move

### Currently in East Coast → Should be West Coast

| Contact | City | Job # | Has Estimates |
|---------|------|-------|---------------|
| James White | Bradenton | 3330-1-0 | No |
| Gary Neiskes | Englewood | 3328-1-0 | **Yes** |
| Henry Germann | Venice | 3329-1-0 | **Yes** |
| Irina Gorovits | Sarasota | 3331-1-0 | No |

**Note:** Henry Germann and Irina Gorovits appear to be duplicates of West Coast entries that already exist. These should be soft-deleted instead of moved.

### Already in Correct Location (No Action Needed)

| Contact | City | Current Location | Correct? |
|---------|------|------------------|----------|
| jj jj | Boca Raton | East Coast | ✓ |
| Grosso House | Delray Beach | East Coast | ✓ |
| Yvonnie Spencer | Miami Gardens | East Coast | ✓ |
| Daniel Murphey | Riviera Beach | East Coast | ✓ |
| Paul Wilbert | Riviera Beach | East Coast | ✓ |
| Don Brandt | Bradenton | West Coast | ✓ |
| Duke Herzel | Bradenton | West Coast | ✓ |
| Barbara Bradley | Bradenton | West Coast | ✓ |
| Rafael Perez | Bradenton | West Coast | ✓ |
| James & Evelyn White | Bradenton | West Coast | ✓ |
| Mike Stipp | Englewood | West Coast | ✓ |
| Paul Batcho | Gulfport | West Coast | ✓ |
| Ron Gagne | Holmes Beach | West Coast | ✓ |
| Edward Lake | Lakeland | West Coast | ✓ |
| Punit Shah | Land O' Lakes | West Coast | ✓ |
| Ron Gagne (3319) | St. Petersburg | West Coast | ✓ |

---

## SQL Script to Run in Supabase SQL Editor

**Run this in the [SQL Editor](https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/sql/new):**

```sql
-- =====================================================
-- STEP 1: Move Gary Neiskes from East Coast to West Coast
-- (Has estimate that needs to stay with the entry)
-- =====================================================
UPDATE pipeline_entries 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'  -- West Coast
WHERE id = '4e207407-1dec-4be1-9866-6bb234ab0c6d';        -- Gary Neiskes (3328-1-0)

UPDATE contacts 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'  -- West Coast
WHERE id = '45b4c650-5749-4661-aa28-87a1c26d6e7b';        -- Gary Neiskes contact

-- =====================================================
-- STEP 2: Soft-delete duplicate entries that already 
-- exist in West Coast (these are the duplicates)
-- =====================================================

-- James White (3330-1-0 East Coast) - Duplicate of (3324-1-0 West Coast "James & Evelyn White")
UPDATE pipeline_entries 
SET is_deleted = true
WHERE id = 'ad5481e3-3e0d-4e2b-b762-fbdfc7e8d30e';

-- Henry Germann (3329-1-0 East Coast) - Duplicate of (3318-1-0 West Coast)
-- NOTE: If this East Coast entry has the estimate, move the estimate first
UPDATE enhanced_estimates 
SET pipeline_entry_id = '9b56de04-684b-4995-aa5b-d2642fdebbf1'  -- West Coast Henry Germann
WHERE pipeline_entry_id = 'c97b5e9e-6a89-4ee5-bebc-405c7fa923a9'; -- East Coast Henry Germann

UPDATE pipeline_entries 
SET is_deleted = true
WHERE id = 'c97b5e9e-6a89-4ee5-bebc-405c7fa923a9';

-- Irina Gorovits (3331-1-0 East Coast) - Duplicate of (3320-1-0 West Coast)
UPDATE pipeline_entries 
SET is_deleted = true
WHERE id = '9e61c71f-1c54-4149-a3c9-acc964de52a0';

-- =====================================================
-- STEP 3: Verify the changes
-- =====================================================
SELECT 
  pe.clj_formatted_number,
  c.first_name || ' ' || c.last_name as contact_name,
  c.address_city,
  l.name as location,
  pe.is_deleted
FROM pipeline_entries pe
JOIN contacts c ON pe.contact_id = c.id
LEFT JOIN locations l ON pe.location_id = l.id
WHERE pe.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  AND c.first_name IN ('Gary', 'James', 'Henry', 'Irina')
ORDER BY c.last_name;
```

---

## Expected Result After Running Script

### East Coast Pipeline (Should Have)
| Contact | City | Has Work |
|---------|------|----------|
| jj jj | Boca Raton | No |
| Grosso House | Delray Beach | Yes (estimate) |
| Yvonnie Spencer | Miami Gardens | Yes (estimate + project) |
| Daniel Murphey | Riviera Beach | Yes (estimate) |
| Paul Wilbert | Riviera Beach | Yes (estimate + project) |

### West Coast Pipeline (Should Have)
| Contact | City | Has Work |
|---------|------|----------|
| Don Brandt | Bradenton | Yes (estimates) |
| Duke Herzel | Bradenton | No |
| Barbara Bradley | Bradenton | No |
| Rafael Perez | Bradenton | No |
| James & Evelyn White | Bradenton | No |
| Mike Stipp | Englewood | No |
| **Gary Neiskes** | Englewood | **Yes (moved)** |
| Paul Batcho | Gulfport | No |
| Ron Gagne | Holmes Beach | No |
| Edward Lake | Lakeland | Yes (estimates) |
| Punit Shah | Land O' Lakes | Yes (estimates) |
| Ron Gagne | St. Petersburg | No |
| Henry Germann | Venice | Yes (estimate moved) |
| Irina Gorovits | Sarasota | No |

---

## No Code Changes Required

This is purely a **data correction** using SQL. The cross-location duplicate prevention code has already been added to `ContactBulkImport.tsx` in the earlier update to prevent this from happening in future imports.

