

# Complete Data Cleanup: Remove All CSV Imports + Fix Location Assignments

## Current Problem (Larger Than Expected)

The earlier SQL scripts were **never executed**. Here's the actual current state:

### CSV Import Contamination (Still Present)
| Location | CSV Import Pipeline Entries | Total CSV Contacts |
|----------|------------------------------|-------------------|
| East Coast | 25 | 3,208 total |
| West Coast | 1 | across tenant |

### Wrong Location Assignments (11 entries in East Coast → Should be West Coast)

| Contact | City | Job # | Lead Source | Has Work? |
|---------|------|-------|-------------|-----------|
| Ibrahim Aldani | Bradenton | 2889-29-0 | csv_import | No |
| James White | Bradenton | 3330-1-0 | manual | No |
| **Gary Neiskes** | Englewood | 3328-1-0 | manual | **1 estimate** |
| Hussein Taha | Englewood | 2646-17-0 | csv_import | No |
| Thomas Dondlinger | North Port | 2596-10-0 | csv_import | No |
| Sonila Cook | Sarasota | 2946-30-0 | csv_import | No |
| Irina Gorovits | Sarasota | 3331-1-0 | manual | No |
| Gerald Rosplock | Sarasota | 3056-31-0 | csv_import | No |
| Patricia Stevenson | Sarasota | 2676-20-0 | csv_import | No |
| Rodney Woods | Sarasota | 2687-22-0 | csv_import | No |
| **Henry Germann** | Venice | 3329-1-0 | manual | **1 estimate** |

---

## Complete Cleanup SQL (Run in Order)

Execute this in the [Supabase SQL Editor](https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/sql/new):

```sql
-- =====================================================
-- STEP 1: Delete ALL CSV imported pipeline entries
-- (26 entries - none have estimates/projects)
-- =====================================================
DELETE FROM pipeline_entries 
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  AND contact_id IN (
    SELECT id FROM contacts 
    WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d' 
      AND lead_source = 'csv_import'
  );

-- =====================================================
-- STEP 2: Delete ALL CSV imported contacts (3,208)
-- =====================================================
DELETE FROM contacts 
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  AND lead_source = 'csv_import';

-- =====================================================
-- STEP 3: Move Gary Neiskes to West Coast (has estimate)
-- =====================================================
UPDATE pipeline_entries 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id = '4e207407-1dec-4be1-9866-6bb234ab0c6d';

UPDATE contacts 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id = '45b4c650-5749-4661-aa28-87a1c26d6e7b';

-- =====================================================
-- STEP 4: Move Henry Germann estimate to West Coast entry
-- then soft-delete East Coast duplicate
-- =====================================================
UPDATE enhanced_estimates 
SET pipeline_entry_id = '9b56de04-684b-4995-aa5b-d2642fdebbf1'
WHERE pipeline_entry_id = 'c97b5e9e-6a89-4ee5-bebc-405c7fa923a9';

UPDATE pipeline_entries 
SET is_deleted = true
WHERE id = 'c97b5e9e-6a89-4ee5-bebc-405c7fa923a9';

-- =====================================================
-- STEP 5: Soft-delete remaining wrong-location entries
-- (James White and Irina Gorovits - duplicates)
-- =====================================================
UPDATE pipeline_entries 
SET is_deleted = true
WHERE id IN (
  'ad5481e3-3e0d-4e2b-b762-fbdfc7e8d30e',  -- James White
  '9e61c71f-1c54-4149-a3c9-acc964de52a0'   -- Irina Gorovits
);

-- =====================================================
-- STEP 6: Verify results
-- =====================================================
SELECT 
  l.name as location,
  COUNT(*) as pipeline_entries,
  SUM(CASE WHEN c.lead_source = 'csv_import' THEN 1 ELSE 0 END) as csv_imports
FROM pipeline_entries pe
JOIN contacts c ON pe.contact_id = c.id
LEFT JOIN locations l ON pe.location_id = l.id
WHERE pe.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  AND pe.is_deleted = false
GROUP BY l.name;
```

---

## Expected Result After Cleanup

### East Coast Pipeline (5 entries - all correct)
| Contact | City | Has Work |
|---------|------|----------|
| jj jj | Boca Raton | No |
| Grosso House | Delray Beach | Yes (estimate) |
| Yvonnie Spencer | Miami Gardens | Yes (estimate + project) |
| Daniel Murphey | Riviera Beach | Yes (estimate) |
| Paul Wilbert | Riviera Beach | Yes (estimate + project) |

### West Coast Pipeline (14 entries - all correct)
| Contact | City | Has Work |
|---------|------|----------|
| Don Brandt | Bradenton | Yes (3 estimates) |
| Duke Herzel | Bradenton | No |
| Barbara Bradley | Bradenton | No |
| Rafael Perez | Bradenton | No |
| James & Evelyn White | Bradenton | No |
| Mike Stipp | Englewood | No |
| Gary Neiskes | Englewood | Yes (1 estimate) |
| Paul Batcho | Gulfport | No |
| Ron Gagne | Holmes Beach | No |
| Edward Lake | Lakeland | Yes (2 estimates) |
| Punit Shah | Land O' Lakes | Yes (3 estimates) |
| Ron Gagne | St. Petersburg | No |
| Henry Germann | Venice | Yes (estimate moved) |
| Irina Gorovits | Sarasota | No |

### Total Cleanup Summary
- **Deleted:** 3,208 CSV imported contacts
- **Deleted:** 26 CSV imported pipeline entries  
- **Moved:** 1 entry (Gary Neiskes) to correct location
- **Merged:** 1 estimate (Henry Germann) to existing West Coast entry
- **Soft-deleted:** 3 duplicate entries

---

## After Running This

1. Refresh the Pipeline page
2. Switch between East Coast and West Coast to verify correct entries
3. Re-import your lists with the correct location selected
4. The duplicate detection will now prevent cross-location contamination

