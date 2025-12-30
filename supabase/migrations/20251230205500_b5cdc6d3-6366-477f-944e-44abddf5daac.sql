-- Add signature linkage columns to enhanced_estimates
ALTER TABLE enhanced_estimates 
ADD COLUMN IF NOT EXISTS signature_envelope_id UUID REFERENCES signature_envelopes(id);

ALTER TABLE enhanced_estimates 
ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

ALTER TABLE enhanced_estimates 
ADD COLUMN IF NOT EXISTS accepted_tier TEXT;

-- Index for public lookups by share_token
CREATE INDEX IF NOT EXISTS idx_enhanced_estimates_share_token 
ON enhanced_estimates(share_token) WHERE share_token IS NOT NULL;

-- Index for signature envelope lookup
CREATE INDEX IF NOT EXISTS idx_enhanced_estimates_signature_envelope 
ON enhanced_estimates(signature_envelope_id) WHERE signature_envelope_id IS NOT NULL;