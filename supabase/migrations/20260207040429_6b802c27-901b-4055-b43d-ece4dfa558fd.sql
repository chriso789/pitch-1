-- Add is_terminal flag to pipeline_stages for statuses like Lost, Canceled, Duplicate
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS is_terminal BOOLEAN DEFAULT false;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_is_terminal ON pipeline_stages(tenant_id, is_terminal) WHERE is_terminal = true;

-- Delete the incorrect generic stages for O'Brien Contracting
DELETE FROM pipeline_stages 
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

-- Insert the correct construction workflow stages with proper keys matching existing entries
INSERT INTO pipeline_stages (tenant_id, name, key, stage_order, color, probability_percent, description, is_active, is_terminal)
VALUES
  ('14de934e-7964-4afd-940a-620d2ace125d', 'Leads', 'lead', 1, '#3b82f6', 10, 'Initial lead intake', true, false),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'Contingency Signed', 'contingency_signed', 2, '#f59e0b', 30, 'Customer signed contingency agreement', true, false),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'Legal Review', 'legal_review', 3, '#8b5cf6', 50, 'Contract under legal review', true, false),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'Ready for Approval', 'ready_for_approval', 4, '#06b6d4', 70, 'Ready for manager approval', true, false),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'Project', 'project', 5, '#22c55e', 90, 'Approved - now a Project', true, false),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'Completed', 'completed', 6, '#10b981', 100, 'Project work completed', true, false),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'Closed', 'closed', 7, '#6b7280', 100, 'Project fully closed', true, true),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'Lost', 'lost', 8, '#ef4444', 0, 'Deal lost', true, true),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'Canceled', 'canceled', 9, '#f97316', 0, 'Deal canceled', true, true),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'Duplicate', 'duplicate', 10, '#94a3b8', 0, 'Duplicate entry', true, true);