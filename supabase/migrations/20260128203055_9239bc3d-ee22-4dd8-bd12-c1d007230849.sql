-- Add estimate metadata columns to documents table
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS estimate_display_name TEXT,
ADD COLUMN IF NOT EXISTS estimate_pricing_tier TEXT CHECK (estimate_pricing_tier IN ('good', 'better', 'best'));