-- Create new job_status enum with 7 stages
CREATE TYPE job_status AS ENUM (
  'lead',
  'legal',
  'contingency',
  'ready_for_approval',
  'production',
  'final_payment',
  'closed'
);

-- Migrate existing jobs data to new status values
-- First, add a temporary column with the new enum type
ALTER TABLE jobs ADD COLUMN new_status job_status;

-- Map existing statuses to new stages
UPDATE jobs SET new_status = CASE
  WHEN status = 'pending' THEN 'lead'::job_status
  WHEN status = 'in_progress' THEN 'production'::job_status
  WHEN status = 'completed' THEN 'closed'::job_status
  WHEN status = 'on_hold' THEN 'contingency'::job_status
  WHEN status = 'cancelled' THEN 'closed'::job_status
  ELSE 'lead'::job_status
END;

-- Drop the old status column and rename new_status to status
ALTER TABLE jobs DROP COLUMN status;
ALTER TABLE jobs RENAME COLUMN new_status TO status;

-- Set default value for new jobs
ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'lead'::job_status;
ALTER TABLE jobs ALTER COLUMN status SET NOT NULL;

-- Update pipeline_status enum to align with job stages
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'legal';
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'contingency';
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'ready_for_approval';
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'production';
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'final_payment';
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'closed';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status ON jobs(tenant_id, status);