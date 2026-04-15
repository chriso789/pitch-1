-- Add auto-close configuration to pipeline stages
ALTER TABLE public.pipeline_stages 
ADD COLUMN IF NOT EXISTS auto_close_days integer DEFAULT NULL;

COMMENT ON COLUMN public.pipeline_stages.auto_close_days IS 'Number of days after which entries in this stage auto-move to closed. NULL = no auto-close.';

-- Add capout verification fields to pipeline_entries
ALTER TABLE public.pipeline_entries
ADD COLUMN IF NOT EXISTS capout_verified_by uuid REFERENCES auth.users(id) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS capout_verified_at timestamptz DEFAULT NULL,
ADD COLUMN IF NOT EXISTS capout_adjustments jsonb DEFAULT NULL;

COMMENT ON COLUMN public.pipeline_entries.capout_verified_by IS 'Manager who verified the cap out sheet';
COMMENT ON COLUMN public.pipeline_entries.capout_verified_at IS 'When the cap out was verified';
COMMENT ON COLUMN public.pipeline_entries.capout_adjustments IS 'Manager adjustments to cap out values: {field: {original, adjusted, reason}}';