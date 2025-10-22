-- Add assigned_to column to jobs table for sales rep assignment
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES profiles(id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_jobs_assigned_to ON jobs(assigned_to);

-- Add comment
COMMENT ON COLUMN jobs.assigned_to IS 'Sales representative assigned to this job';

-- Update existing jobs to copy assigned_to from their pipeline_entries if they exist
UPDATE jobs j
SET assigned_to = pe.assigned_to
FROM pipeline_entries pe
WHERE j.pipeline_entry_id = pe.id
AND j.assigned_to IS NULL
AND pe.assigned_to IS NOT NULL;