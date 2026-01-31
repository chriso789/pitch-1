
# Fix: Cross-Location Data Contamination in Pipeline

## ✅ COMPLETED

### Part 1: Database Cleanup (RUN THIS SQL)

**Run this SQL in Supabase SQL Editor to clean up the duplicate East Coast entries:**

```sql
-- Soft-delete the duplicate East Coast pipeline entries
UPDATE pipeline_entries 
SET is_deleted = true
WHERE id IN (
  SELECT pe1.id
  FROM pipeline_entries pe1
  JOIN contacts c1 ON pe1.contact_id = c1.id
  JOIN pipeline_entries pe2 ON pe2.id != pe1.id
  JOIN contacts c2 ON pe2.contact_id = c2.id
  WHERE pe1.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
    AND pe2.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
    AND pe1.is_deleted = false
    AND pe2.is_deleted = false
    AND pe1.location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6' -- East Coast
    AND pe2.location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16' -- West Coast
    AND pe1.created_at > pe2.created_at  -- East Coast was created AFTER West Coast (duplicate)
    AND REGEXP_REPLACE(c1.phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(c2.phone, '[^0-9]', '', 'g')
);
```

### Part 2: Prevention Code (COMPLETED ✅)

Added cross-location duplicate detection to `ContactBulkImport.tsx`:

1. ✅ Added `checkForDuplicatesAcrossLocations()` function
2. ✅ Added state for tracking duplicates: `crossLocationDuplicates`, `cleanContactsForImport`
3. ✅ Checks for duplicates during CSV file upload
4. ✅ Shows warning UI listing contacts that exist in other locations
5. ✅ Filters out duplicates during import

## Expected Behavior

- **Data Cleanup**: After running the SQL, East Coast will no longer show West Coast duplicates
- **Future Prevention**: When importing contacts, the system now:
  - Checks if phone numbers already exist in other locations
  - Shows a warning listing the duplicates with their location
  - Automatically skips importing those duplicates
