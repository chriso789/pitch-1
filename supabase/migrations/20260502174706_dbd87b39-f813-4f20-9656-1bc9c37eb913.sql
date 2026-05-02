-- Add conversion point flag to pipeline_stages
ALTER TABLE public.pipeline_stages 
ADD COLUMN IF NOT EXISTS is_conversion_point BOOLEAN NOT NULL DEFAULT false;

-- Add a comment explaining the column
COMMENT ON COLUMN public.pipeline_stages.is_conversion_point IS 'When true, moving a lead to this stage converts it to a project (triggers production board entry, AR tracking, etc.)';
