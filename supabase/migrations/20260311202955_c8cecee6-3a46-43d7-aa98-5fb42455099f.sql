INSERT INTO contact_statuses (tenant_id, name, key, color, description, status_order, is_active)
SELECT DISTINCT t.id, 'New Roof', 'new_roof', '#06b6d4', 'Homeowner needs a new roof', 8, true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM contact_statuses cs WHERE cs.tenant_id = t.id AND cs.key = 'new_roof'
);