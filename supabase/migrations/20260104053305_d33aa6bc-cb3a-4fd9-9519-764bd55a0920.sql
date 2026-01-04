-- Insert default templates with correct column names (status instead of is_active)
INSERT INTO smart_doc_templates (slug, title, category, content, status, tenant_id)
SELECT 
  'estimate' as slug,
  'Estimate Template' as title,
  'estimate' as category,
  '<html><body><h1>Estimate for {{contact.full_name}}</h1><p>Company: {{company.name}}</p><p>Address: {{contact.address}}</p><p>Total: {{estimate.total}}</p></body></html>' as content,
  'active' as status,
  t.id as tenant_id
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM smart_doc_templates WHERE slug = 'estimate' AND tenant_id = t.id
)
ON CONFLICT DO NOTHING;

INSERT INTO smart_doc_templates (slug, title, category, content, status, tenant_id)
SELECT 
  'proposal' as slug,
  'Proposal Template' as title,
  'proposal' as category,
  '<html><body><h1>Proposal for {{contact.full_name}}</h1><p>Company: {{company.name}}</p><p>Scope: {{project.scope}}</p></body></html>' as content,
  'active' as status,
  t.id as tenant_id
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM smart_doc_templates WHERE slug = 'proposal' AND tenant_id = t.id
)
ON CONFLICT DO NOTHING;

INSERT INTO smart_doc_templates (slug, title, category, content, status, tenant_id)
SELECT 
  'contract' as slug,
  'Contract Template' as title,
  'contract' as category,
  '<html><body><h1>Contract Agreement</h1><p>Client: {{contact.full_name}}</p><p>Contractor: {{company.name}}</p></body></html>' as content,
  'active' as status,
  t.id as tenant_id
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM smart_doc_templates WHERE slug = 'contract' AND tenant_id = t.id
)
ON CONFLICT DO NOTHING;