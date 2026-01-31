

# Move 7 Pipeline Entries to West Coast Location

## Summary

All 7 entries shown in the screenshot are currently assigned to **East Coast** but based on their city addresses, they belong to **West Coast**:

| Job # | Contact | City | Has Documents | Has Estimates | Has Measurements |
|-------|---------|------|---------------|---------------|------------------|
| 3331-1-0 | Irina Gorovits | Sarasota | ❌ | ❌ | ❌ |
| 3330-1-0 | James White | Bradenton | ✅ 2 docs | ❌ | ✅ 1 measurement |
| 3329-1-0 | Henry Germann | Venice | ✅ 3 docs | ✅ 1 estimate | ✅ 1 measurement |
| 3328-1-0 | Gary Neiskes | Englewood | ✅ 3 docs | ✅ 1 estimate | ✅ 1 measurement |
| 2889-29-0 | Ibrahim Aldani | Bradenton | ❌ | ❌ | ❌ |
| 2676-20-0 | Patricia Stevenson | Sarasota | ❌ | ❌ | ❌ |
| 2646-17-0 | Hussein Taha | Englewood | ❌ | ❌ | ❌ |

---

## SQL Script to Execute

Run this in the [Supabase SQL Editor](https://supabase.com/dashboard/project/alxelfrbjzkmtnsulcei/sql/new):

```sql
-- =====================================================
-- MOVE ALL 7 PIPELINE ENTRIES + CONTACTS TO WEST COAST
-- West Coast ID: c490231c-2a0e-4afc-8412-672e1c890c16
-- =====================================================

-- STEP 1: Update pipeline_entries location
UPDATE pipeline_entries 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id IN (
  '9e61c71f-1c54-4149-a3c9-acc964de52a0',  -- Irina Gorovits (3331-1-0)
  'ad5481e3-3e0d-4e2b-b762-fbdfc7e8d30e',  -- James White (3330-1-0)
  'c97b5e9e-6a89-4ee5-bebc-405c7fa923a9',  -- Henry Germann (3329-1-0)
  '4e207407-1dec-4be1-9866-6bb234ab0c6d',  -- Gary Neiskes (3328-1-0)
  'ba5cee78-82c3-48cc-b237-b24b9077ad15',  -- Ibrahim Aldani (2889-29-0)
  'dc3e0872-0a26-476c-8eac-edc7ae4647ee',  -- Patricia Stevenson (2676-20-0)
  '357f1c3e-2380-4824-b0db-730861895ee4'   -- Hussein Taha (2646-17-0)
);

-- STEP 2: Update contacts location
UPDATE contacts 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id IN (
  '3f920702-da3f-4623-8d96-ff032196d41f',  -- Irina Gorovits
  'f3361491-c9c0-4aeb-8c83-b10c6080a65b',  -- James White
  '5fab3c39-def5-4104-a595-2052b1334fa9',  -- Henry Germann
  '45b4c650-5749-4661-aa28-87a1c26d6e7b',  -- Gary Neiskes
  '7b4ae1de-43f8-4bfb-8662-5b08a8f6db2b',  -- Ibrahim Aldani
  'e85cf7a3-abe3-4f61-9893-b5e3f70c0422',  -- Patricia Stevenson
  '3fffddd3-c454-4ad7-86be-a1ca7a3f4a3f'   -- Hussein Taha
);

-- STEP 3: Update documents location (8 documents)
UPDATE documents 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id IN (
  -- Gary Neiskes (3 docs)
  '98ad03db-8312-4d63-9ecc-a9503db8c33c',
  '383d0dd3-5f39-4da7-ac73-e89ad99fc7dc',
  '8955080f-571d-46cf-946f-cd1c62196750',
  -- James White (2 docs)
  '7661a018-399e-458f-96a7-d071d1f7bdc1',
  '3fcec3cb-c7f5-4651-abb2-320edcff6867',
  -- Henry Germann (3 docs)
  '0662d505-f7f5-4132-a207-26e2ef3c509e',
  '4b19934b-c783-49a1-ba39-fc61f40061ed',
  '283f0b6d-5520-4163-88de-7a3e29e8b677'
);

-- STEP 4: Update enhanced_estimates location (2 estimates)
UPDATE enhanced_estimates 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id IN (
  '763b8b9d-d7e0-45bb-9e59-f7f590d957e2',  -- Gary Neiskes estimate
  'e500a7f1-9482-4557-89b7-a6bf98aaf8db'   -- Henry Germann estimate
);

-- STEP 5: Update roof_measurements location (3 measurements)
UPDATE roof_measurements 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id IN (
  'eeaa88c5-31ac-4f4d-b99c-8d3204e3c602',  -- Gary Neiskes measurement
  '9cb94fbd-2cea-4bd1-ae5b-6f1485b7b4f6',  -- James White measurement
  '243ccfb3-8aba-4a69-81c6-7826dc675101'   -- Henry Germann measurement
);

-- =====================================================
-- VERIFICATION: Check the results
-- =====================================================
SELECT 
  pe.clj_formatted_number,
  c.first_name || ' ' || c.last_name as contact_name,
  c.address_city,
  l.name as new_location
FROM pipeline_entries pe
JOIN contacts c ON pe.contact_id = c.id
LEFT JOIN locations l ON pe.location_id = l.id
WHERE pe.id IN (
  '9e61c71f-1c54-4149-a3c9-acc964de52a0',
  'ad5481e3-3e0d-4e2b-b762-fbdfc7e8d30e',
  'c97b5e9e-6a89-4ee5-bebc-405c7fa923a9',
  '4e207407-1dec-4be1-9866-6bb234ab0c6d',
  'ba5cee78-82c3-48cc-b237-b24b9077ad15',
  'dc3e0872-0a26-476c-8eac-edc7ae4647ee',
  '357f1c3e-2380-4824-b0db-730861895ee4'
)
ORDER BY pe.clj_formatted_number DESC;
```

---

## What Gets Moved

| Record Type | Count | Details |
|-------------|-------|---------|
| Pipeline Entries | 7 | All entries from screenshot |
| Contacts | 7 | Associated contact records |
| Documents | 8 | Measurement reports + estimates PDFs |
| Estimates | 2 | Gary Neiskes + Henry Germann |
| Roof Measurements | 3 | Gary, James, Henry |

---

## Expected Result

After running the script:
1. All 7 entries will appear in **West Coast** pipeline
2. All associated documents, estimates, and measurements remain linked
3. **East Coast** pipeline will only contain Boca Raton/Delray Beach/Miami/Riviera Beach entries

