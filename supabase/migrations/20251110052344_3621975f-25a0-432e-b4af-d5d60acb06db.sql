-- Create storage bucket for satellite image cache
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'satellite-cache',
  'satellite-cache',
  true,
  10485760, -- 10MB limit per image
  ARRAY['image/png', 'image/jpeg', 'image/jpg']
)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for satellite cache bucket
CREATE POLICY "Public read access for satellite images"
ON storage.objects FOR SELECT
USING (bucket_id = 'satellite-cache');

CREATE POLICY "Service role can insert satellite images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'satellite-cache');

CREATE POLICY "Service role can update satellite images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'satellite-cache');

CREATE POLICY "Service role can delete satellite images"
ON storage.objects FOR DELETE
USING (bucket_id = 'satellite-cache');

-- Create table to track cache metadata and statistics
CREATE TABLE IF NOT EXISTS public.satellite_image_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL UNIQUE,
  storage_path TEXT NOT NULL,
  lat DECIMAL(10, 7) NOT NULL,
  lng DECIMAL(10, 7) NOT NULL,
  zoom INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  maptype TEXT NOT NULL,
  file_size_bytes INTEGER,
  access_count INTEGER DEFAULT 1,
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  tenant_id UUID REFERENCES auth.users(id)
);

-- Enable RLS on cache table
ALTER TABLE public.satellite_image_cache ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for cache table
CREATE POLICY "Anyone can read cache metadata"
ON public.satellite_image_cache FOR SELECT
USING (true);

CREATE POLICY "Service role can insert cache metadata"
ON public.satellite_image_cache FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service role can update cache metadata"
ON public.satellite_image_cache FOR UPDATE
USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_satellite_cache_key ON public.satellite_image_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_satellite_cache_location ON public.satellite_image_cache(lat, lng);
CREATE INDEX IF NOT EXISTS idx_satellite_cache_accessed ON public.satellite_image_cache(last_accessed_at DESC);

-- Create function to update access statistics
CREATE OR REPLACE FUNCTION update_cache_access_stats(p_cache_key TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.satellite_image_cache
  SET 
    access_count = access_count + 1,
    last_accessed_at = now()
  WHERE cache_key = p_cache_key;
END;
$$;