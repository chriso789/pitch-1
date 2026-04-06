-- Create training_pairs table for Stage 4 spatial alignment data
CREATE TABLE public.training_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address TEXT NOT NULL,
  lat DECIMAL(10,8) NOT NULL,
  lng DECIMAL(11,8) NOT NULL,
  aerial_image_url TEXT NOT NULL,
  mask_storage_path TEXT,
  vendor_source TEXT,
  alignment_quality DECIMAL(5,4),
  alignment_matrix JSONB,
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score DECIMAL(5,4),
  is_verified BOOLEAN DEFAULT false,
  tenant_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.training_pairs ENABLE ROW LEVEL SECURITY;

-- RLS: Authenticated users can read training pairs for their tenant
CREATE POLICY "Users can view tenant training pairs"
  ON public.training_pairs
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL
    OR tenant_id IN (
      SELECT p.tenant_id::text FROM public.profiles p
      WHERE p.id = auth.uid()
    )
  );

-- RLS: Authenticated users can insert training pairs
CREATE POLICY "Users can create training pairs"
  ON public.training_pairs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Index for tenant lookups
CREATE INDEX idx_training_pairs_tenant_id ON public.training_pairs (tenant_id);

-- Index for quality filtering
CREATE INDEX idx_training_pairs_quality ON public.training_pairs (alignment_quality, confidence_score);