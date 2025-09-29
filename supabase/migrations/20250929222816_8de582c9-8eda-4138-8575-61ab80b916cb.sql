-- Add soft delete columns to pipeline_entries table
ALTER TABLE public.pipeline_entries 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

-- Create index for efficient querying of non-deleted entries
CREATE INDEX IF NOT EXISTS idx_pipeline_entries_is_deleted ON public.pipeline_entries(is_deleted) WHERE is_deleted = false;

-- Update existing queries to filter out soft-deleted entries
COMMENT ON COLUMN public.pipeline_entries.is_deleted IS 'Soft delete flag - false means active, true means deleted';
COMMENT ON COLUMN public.pipeline_entries.deleted_at IS 'Timestamp when the entry was soft deleted';
COMMENT ON COLUMN public.pipeline_entries.deleted_by IS 'User who soft deleted the entry';