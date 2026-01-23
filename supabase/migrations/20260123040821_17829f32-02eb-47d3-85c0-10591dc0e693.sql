-- =============================================================
-- FIX: Migrate pipeline entries from 'qualified' to 'contingency_signed'
-- 'Qualified' is a CONTACT status, not a pipeline stage
-- =============================================================

-- Step 1: Update all pipeline entries with status = 'qualified' to 'contingency_signed'
UPDATE pipeline_entries
SET 
  status = 'contingency_signed',
  updated_at = NOW()
WHERE status = 'qualified';

-- Step 2: Log how many were updated (for debugging purposes, this is a comment)
-- The pipeline flow is now: lead -> contingency_signed -> legal_review -> ready_for_approval -> project