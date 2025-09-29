-- Add 'ready_for_approval' to pipeline_status enum
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'ready_for_approval';