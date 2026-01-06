-- Create storage bucket for project invoices
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-invoices', 'project-invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for project-invoices bucket
CREATE POLICY "Users can upload invoices for their tenant"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'project-invoices' AND
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.tenant_id IS NOT NULL
  )
);

CREATE POLICY "Users can view invoices from their tenant"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'project-invoices' AND
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.tenant_id IS NOT NULL
  )
);

CREATE POLICY "Users can update invoices from their tenant"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'project-invoices' AND
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.tenant_id IS NOT NULL
  )
);

CREATE POLICY "Users can delete invoices from their tenant"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'project-invoices' AND
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.tenant_id IS NOT NULL
  )
);