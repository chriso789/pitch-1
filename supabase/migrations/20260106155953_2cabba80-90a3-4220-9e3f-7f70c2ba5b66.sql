-- Make project-invoices bucket public for document access
UPDATE storage.buckets 
SET public = true 
WHERE name = 'project-invoices';

-- Also ensure the documents bucket is public
UPDATE storage.buckets 
SET public = true 
WHERE name = 'documents';