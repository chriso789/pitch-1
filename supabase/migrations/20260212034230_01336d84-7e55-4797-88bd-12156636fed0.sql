
-- 1. Remove pipeline stage entries from contact_statuses table
DELETE FROM contact_statuses 
WHERE key IN ('legal_review', 'contingency_signed', 'project');

-- 2. Reset contacts that have pipeline stage values back to NULL
UPDATE contacts 
SET qualification_status = NULL, updated_at = NOW()
WHERE qualification_status IN (
  'legal_review', 'contingency_signed', 'project', 
  'ready_for_approval', 'completed', 'lead', 'new_lead'
);
