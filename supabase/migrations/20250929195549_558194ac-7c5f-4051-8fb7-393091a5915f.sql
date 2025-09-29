-- Fix corrupted pipeline entry statuses
UPDATE pipeline_entries 
SET status = 'lead', updated_at = now()
WHERE status NOT IN ('lead', 'legal_review', 'contingency_signed', 'project', 'completed', 'closed', 'lost', 'canceled', 'duplicate');