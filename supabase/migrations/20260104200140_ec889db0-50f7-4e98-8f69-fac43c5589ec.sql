-- Backfill existing tenants with default approval requirements
-- Valid validation_types: 'document', 'estimate', 'line_items', 'photos', 'custom'

INSERT INTO tenant_approval_requirements (tenant_id, requirement_key, label, icon_name, is_active, is_required, sort_order, validation_type)
SELECT t.id, 'contract', 'Contract', 'FileText', true, true, 1, 'document'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_approval_requirements tar 
  WHERE tar.tenant_id = t.id AND tar.requirement_key = 'contract'
);

INSERT INTO tenant_approval_requirements (tenant_id, requirement_key, label, icon_name, is_active, is_required, sort_order, validation_type)
SELECT t.id, 'estimate', 'Estimate', 'DollarSign', true, true, 2, 'estimate'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_approval_requirements tar 
  WHERE tar.tenant_id = t.id AND tar.requirement_key = 'estimate'
);

INSERT INTO tenant_approval_requirements (tenant_id, requirement_key, label, icon_name, is_active, is_required, sort_order, validation_type)
SELECT t.id, 'notice_of_commencement', 'Notice of Commencement', 'Package', true, false, 3, 'document'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_approval_requirements tar 
  WHERE tar.tenant_id = t.id AND tar.requirement_key = 'notice_of_commencement'
);

INSERT INTO tenant_approval_requirements (tenant_id, requirement_key, label, icon_name, is_active, is_required, sort_order, validation_type)
SELECT t.id, 'required_photos', 'Required Photos', 'Camera', true, false, 4, 'photos'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_approval_requirements tar 
  WHERE tar.tenant_id = t.id AND tar.requirement_key = 'required_photos'
);