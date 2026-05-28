-- Clean up orphan/duplicate document rows on Brittany Jones' project (pipeline 0e880d5e)
-- 1. Remove duplicate OBR-00055 rows, keep the most recent one (7315084e)
DELETE FROM public.documents
WHERE id IN ('4f74da0e-f3ff-48b6-91d3-87fab2a22fb5','35fb02ce-755f-4d70-b000-44a6ac743a67');

-- 2. Remove the OBR-00056 row whose storage object no longer exists
DELETE FROM public.documents
WHERE id = 'f9211bb9-4bcb-45b2-aa71-c0267ab73733';