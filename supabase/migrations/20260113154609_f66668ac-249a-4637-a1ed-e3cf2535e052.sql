-- Create function_cache table if it doesn't exist
CREATE TABLE IF NOT EXISTS function_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL,
  result TEXT NOT NULL,
  ttl_seconds INTEGER DEFAULT 3600,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cache lookups
CREATE INDEX IF NOT EXISTS idx_function_cache_key ON function_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_function_cache_created ON function_cache(created_at);

-- Enable RLS
ALTER TABLE function_cache ENABLE ROW LEVEL SECURITY;

-- Policy for service role access
CREATE POLICY "Service role can manage cache"
  ON function_cache FOR ALL
  USING (true);