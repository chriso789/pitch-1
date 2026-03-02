
-- =============================================
-- Phase 1A: Fix 15 location-mismatched contacts
-- Move 14 contacts from West Coast to East Coast (to match their pipeline entries)
-- =============================================
UPDATE contacts SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af', updated_at = now()
WHERE id IN (
  'c05a54e5-4c1c-4328-a660-54466e9535c6', 'a9535cdf-7685-4af0-a0d9-265c89ecd773',
  '832748df-068a-4964-b33d-7da4b9444a62', 'c07e593e-3377-45da-a907-e403665186b0',
  'e16257cf-d60a-4673-97cb-8e7be6a3f17a', '6d7e340a-4da0-4bf5-817d-386c72ec0a17',
  '5f9b28d1-9b0a-45af-93b3-8eb9e93157f7', '57e4be68-0f40-4083-990d-7ce0ad590311',
  '7b4ab1b4-dd1d-47a2-99c2-6a45c0d24dd8', 'c9069213-3585-4b0f-8677-571414285864',
  'e55c8068-bdce-4053-be24-cebbf29784fe', '63c7be97-d58a-484e-abb2-754fa8c44d86',
  '3a567ea5-e73c-41fe-91aa-aab600676bac', '297f1ccd-9b61-443c-bda3-0ccf78acd946'
)
AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

-- Move 1 contact (Barbara Bradley) from East Coast to West Coast
UPDATE contacts SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16', updated_at = now()
WHERE id = '0ca0a474-255c-480f-afbe-467ad8f2d1a7'
AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

-- =============================================
-- Phase 1B: Merge cross-location duplicates
-- =============================================

-- Duplicate 1: Darbouze - keep ca5eb789 (older, WC), re-link & delete 1077aef5 (EC)
UPDATE pipeline_entries SET contact_id = 'ca5eb789-08ad-4d94-b9ad-4b9dd5b9aef3'
WHERE contact_id = '1077aef5-1c0d-4c6e-9cec-2d50b435fd0a'
AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

UPDATE contacts SET is_deleted = true, updated_at = now()
WHERE id = '1077aef5-1c0d-4c6e-9cec-2d50b435fd0a'
AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

-- Duplicate 2: Perez - keep f928e6f3 (has pipeline entry, WC), delete 3c6435dc (EC, 0 entries)
UPDATE pipeline_entries SET contact_id = 'f928e6f3-d771-4d41-9f77-fe85cbbdde6a'
WHERE contact_id = '3c6435dc-c9f4-4492-b738-2f43aa024b8a'
AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

UPDATE contacts SET is_deleted = true, updated_at = now()
WHERE id = '3c6435dc-c9f4-4492-b738-2f43aa024b8a'
AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

-- Duplicate 3: White family - keep 0fb6d0c0 ("James & Evelyn White", WC, has pipeline)
-- and f3361491 ("James White", WC, has pipeline) as separate contacts since different names.
-- Delete 6db389a2 ("Evelyn White", EC, 0 entries) - re-link any entries first
UPDATE pipeline_entries SET contact_id = '0fb6d0c0-c083-4a30-a450-11d91661e19a'
WHERE contact_id = '6db389a2-84f1-485a-818d-b06573e494dc'
AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

UPDATE contacts SET is_deleted = true, updated_at = now()
WHERE id = '6db389a2-84f1-485a-818d-b06573e494dc'
AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';
