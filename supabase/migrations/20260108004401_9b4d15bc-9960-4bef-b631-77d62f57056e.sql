-- ========================================
-- CUSTOMER PHOTOS SCHEMA ENHANCEMENTS
-- ========================================

-- Add missing columns to customer_photos table for full photo control center
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES pipeline_entries(id) ON DELETE SET NULL;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS annotations_json JSONB;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES profiles(id);
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS include_in_estimate BOOLEAN DEFAULT false;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS gps_latitude NUMERIC(10, 8);
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS gps_longitude NUMERIC(11, 8);
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS ai_analysis JSONB;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS original_filename TEXT;

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_customer_photos_lead ON customer_photos(lead_id);
CREATE INDEX IF NOT EXISTS idx_customer_photos_contact ON customer_photos(contact_id);
CREATE INDEX IF NOT EXISTS idx_customer_photos_category ON customer_photos(category);
CREATE INDEX IF NOT EXISTS idx_customer_photos_estimate ON customer_photos(include_in_estimate) WHERE include_in_estimate = true;
CREATE INDEX IF NOT EXISTS idx_customer_photos_order ON customer_photos(lead_id, display_order);

-- ========================================
-- CUSTOMER PHOTOS STORAGE BUCKET
-- ========================================

-- Create the customer-photos bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('customer-photos', 'customer-photos', true)
ON CONFLICT (id) DO NOTHING;

-- ========================================
-- STORAGE RLS POLICIES
-- ========================================

-- Drop existing policies if they exist (to allow clean recreation)
DROP POLICY IF EXISTS "Tenant users can upload to customer-photos" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can view customer-photos" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can delete customer-photos" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can update customer-photos" ON storage.objects;

-- RLS policy for tenant-isolated uploads
CREATE POLICY "Tenant users can upload to customer-photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'customer-photos' AND
  (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);

-- RLS policy for viewing photos
CREATE POLICY "Tenant users can view customer-photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'customer-photos' AND
  (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);

-- RLS policy for updating photos
CREATE POLICY "Tenant users can update customer-photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'customer-photos' AND
  (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);

-- RLS policy for deleting photos
CREATE POLICY "Tenant users can delete customer-photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'customer-photos' AND
  (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);