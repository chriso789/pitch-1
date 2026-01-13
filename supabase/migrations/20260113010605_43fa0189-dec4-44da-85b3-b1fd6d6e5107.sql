-- Add is_feature_injection column to measurement_corrections table
-- This identifies corrections where AI produced NO feature but user traced one
-- These should be INJECTED into future measurements rather than just multiplied

ALTER TABLE public.measurement_corrections 
ADD COLUMN IF NOT EXISTS is_feature_injection BOOLEAN DEFAULT FALSE;

-- Add index for faster lookups of feature injections
CREATE INDEX IF NOT EXISTS idx_measurement_corrections_feature_injection 
ON public.measurement_corrections(tenant_id, is_feature_injection) 
WHERE is_feature_injection = TRUE;

-- Add comment for documentation
COMMENT ON COLUMN public.measurement_corrections.is_feature_injection IS 
'True when AI produced 0 features of this type but user traced them. These should be injected into future measurements, not multiplied.';