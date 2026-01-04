-- Delete Acme Roofing demo data COMPLETELY
-- Tenant ID: 550e8400-e29b-41d4-a716-446655440000

-- 1. Delete project_budget_snapshots first (references estimates)
DELETE FROM project_budget_snapshots WHERE estimate_id IN (
  SELECT id FROM estimates WHERE pipeline_entry_id IN (
    SELECT id FROM pipeline_entries WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000'
  )
);

-- 2. Delete estimate_line_items
DELETE FROM estimate_line_items WHERE estimate_id IN (
  SELECT id FROM estimates WHERE pipeline_entry_id IN (
    SELECT id FROM pipeline_entries WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000'
  )
);

-- 3. Delete estimates
DELETE FROM estimates WHERE pipeline_entry_id IN (
  SELECT id FROM pipeline_entries WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000'
);

-- 4. Delete jobs (may reference contacts or projects)
DELETE FROM jobs WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- 5. Delete projects
DELETE FROM projects WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- 6. Delete pipeline entries
DELETE FROM pipeline_entries WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- 7. Delete contacts
DELETE FROM contacts WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- 8. Delete estimate templates
DELETE FROM estimate_templates WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- 9. Delete commission plans
DELETE FROM commission_plans WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- 10. Delete supplier pricebooks
DELETE FROM supplier_pricebooks WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- 11. Delete user company access
DELETE FROM user_company_access WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- 12. Delete tenant settings
DELETE FROM tenant_settings WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- 13. Finally delete the tenant itself
DELETE FROM tenants WHERE id = '550e8400-e29b-41d4-a716-446655440000';