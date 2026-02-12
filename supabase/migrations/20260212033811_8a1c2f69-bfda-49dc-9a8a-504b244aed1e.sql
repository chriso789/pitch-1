
-- Fix storm_damage_ trailing underscore to match existing contact data
UPDATE contact_statuses 
SET key = 'storm_damage' 
WHERE key = 'storm_damage_' AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

-- Fix old_roof_marketing_ trailing underscore too
UPDATE contact_statuses 
SET key = 'old_roof_marketing' 
WHERE key = 'old_roof_marketing_' AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';

-- Add missing statuses that exist in contact data but have no board columns
INSERT INTO contact_statuses (tenant_id, key, name, color, status_order, is_active)
VALUES 
  ('14de934e-7964-4afd-940a-620d2ace125d', 'not_home', 'Not Home', '#6b7280', 2, true),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'legal_review', 'Legal Review', '#8b5cf6', 6, true),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'contingency_signed', 'Contingency Signed', '#059669', 10, true)
ON CONFLICT DO NOTHING;

-- Normalize 'unqualified' contacts to NULL so they appear in "New / Unassigned"
UPDATE contacts 
SET qualification_status = NULL 
WHERE qualification_status = 'unqualified' 
  AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';
