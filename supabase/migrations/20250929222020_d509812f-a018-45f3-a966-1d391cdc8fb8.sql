-- Add soft delete columns to jobs table
ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) DEFAULT NULL;

-- Create index for faster queries on non-deleted jobs
CREATE INDEX IF NOT EXISTS idx_jobs_is_deleted ON public.jobs(is_deleted) WHERE is_deleted = false;

-- Add comment for documentation
COMMENT ON COLUMN public.jobs.is_deleted IS 'Soft delete flag - true if job is deleted';
COMMENT ON COLUMN public.jobs.deleted_at IS 'Timestamp when job was soft deleted';
COMMENT ON COLUMN public.jobs.deleted_by IS 'User who deleted the job';