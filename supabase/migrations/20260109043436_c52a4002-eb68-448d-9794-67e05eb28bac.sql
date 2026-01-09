-- Add secondary rep support to pipeline_entries
ALTER TABLE pipeline_entries 
ADD COLUMN IF NOT EXISTS secondary_assigned_to UUID REFERENCES profiles(id);

-- Add commission split percentage (how much goes to primary rep)
ALTER TABLE pipeline_entries 
ADD COLUMN IF NOT EXISTS primary_rep_split_percent NUMERIC(5,2) DEFAULT 50;

-- Index for querying by secondary rep
CREATE INDEX IF NOT EXISTS idx_pipeline_entries_secondary_assigned 
ON pipeline_entries(secondary_assigned_to) WHERE secondary_assigned_to IS NOT NULL;

-- Index for fast filtering of active users
CREATE INDEX IF NOT EXISTS idx_profiles_is_active_tenant 
ON profiles(tenant_id, is_active) WHERE is_active = true;

-- Add logo_url to locations if not exists
ALTER TABLE locations 
ADD COLUMN IF NOT EXISTS logo_url TEXT;