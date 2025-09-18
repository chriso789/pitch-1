-- SMART DOCS Sample Data Only
-- Insert global tag catalog for all contexts
INSERT INTO public.smartdoc_tag_catalog (name, description, example_value, context_type, is_sensitive, transform_support) VALUES
-- Contact tags
('contact.full_name', 'Full name of the contact', 'John Smith', 'CONTACT', false, ARRAY['upper', 'title']),
('contact.first_name', 'First name of the contact', 'John', 'CONTACT', false, ARRAY['upper', 'title']),
('contact.last_name', 'Last name of the contact', 'Smith', 'CONTACT', false, ARRAY['upper', 'title']),
('contact.email', 'Email address', 'john.smith@email.com', 'CONTACT', false, ARRAY['lower']),
('contact.phone', 'Phone number', '(555) 123-4567', 'CONTACT', false, ARRAY['phone_us']),
('contact.address.street', 'Street address', '123 Main Street', 'CONTACT', false, ARRAY['title']),
('contact.address.city', 'City', 'Springfield', 'CONTACT', false, ARRAY['title']),
('contact.address.state', 'State', 'IL', 'CONTACT', false, ARRAY['upper']),
('contact.address.zip', 'ZIP code', '62701', 'CONTACT', false, NULL),
('contact.address.full', 'Complete address', '123 Main Street, Springfield, IL 62701', 'CONTACT', false, NULL),

-- Project tags
('project.name', 'Project name', 'Smith Roof Replacement', 'PROJECT', false, ARRAY['title']),
('project.number', 'Project number', 'PROJ-2025-0001', 'PROJECT', false, NULL),
('project.start_date', 'Project start date', '2025-03-15', 'PROJECT', false, ARRAY['date']),
('project.completion_date', 'Expected completion date', '2025-03-25', 'PROJECT', false, ARRAY['date']),
('project.status', 'Project status', 'Active', 'PROJECT', false, ARRAY['title']),

-- Estimate tags
('estimate.number', 'Estimate number', 'EST-2025-0001', 'ESTIMATE', false, NULL),
('estimate.selling_price', 'Total selling price', '$15,750.00', 'ESTIMATE', false, ARRAY['currency']),
('estimate.material_cost', 'Material cost', '$8,500.00', 'ESTIMATE', true, ARRAY['currency']),
('estimate.labor_cost', 'Labor cost', '$4,200.00', 'ESTIMATE', true, ARRAY['currency']),
('estimate.overhead_amount', 'Overhead amount', '$1,050.00', 'ESTIMATE', true, ARRAY['currency']),
('estimate.actual_profit', 'Actual profit', '$2,000.00', 'ESTIMATE', true, ARRAY['currency']),
('estimate.actual_margin_percent', 'Profit margin percentage', '12.7%', 'ESTIMATE', true, ARRAY['percent']),
('estimate.created_date', 'Estimate creation date', '2025-01-15', 'ESTIMATE', false, ARRAY['date']),
('estimate.valid_until', 'Estimate expiration date', '2025-02-15', 'ESTIMATE', false, ARRAY['date']),

-- Company/Rep tags
('company.name', 'Company name', 'O''Brien Contracting', 'PROJECT', false, NULL),
('company.license', 'License number', 'CCC1335947', 'PROJECT', false, NULL),
('company.phone', 'Company phone', '(555) 123-ROOF', 'PROJECT', false, ARRAY['phone_us']),
('company.email', 'Company email', 'info@obriencontracting.com', 'PROJECT', false, ARRAY['lower']),
('company.address', 'Company address', '456 Business Blvd, Springfield, IL 62701', 'PROJECT', false, NULL),
('rep.name', 'Sales representative name', 'Chris O''Brien', 'ESTIMATE', false, ARRAY['title']),
('rep.phone', 'Rep phone number', '(555) 123-4567', 'ESTIMATE', false, ARRAY['phone_us']),
('rep.email', 'Rep email address', 'chris@obriencontracting.com', 'ESTIMATE', false, ARRAY['lower'])

ON CONFLICT (name, context_type) DO NOTHING;

-- Insert sample folders for O'Brien Contracting
INSERT INTO public.smartdoc_folders (tenant_id, name, created_by)
SELECT 
  t.id,
  folder.name,
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid
FROM (VALUES 
  ('Proposals'),
  ('Contracts'), 
  ('Change Orders'),
  ('Insurance Documents'),
  ('Completion Certificates'),
  ('Marketing Materials')
) AS folder(name)
CROSS JOIN public.tenants t
WHERE t.name = 'O''Brien Contracting'
AND NOT EXISTS (
  SELECT 1 FROM public.smartdoc_folders 
  WHERE name = folder.name AND tenant_id = t.id
);

-- Insert sample templates for O'Brien Contracting
INSERT INTO public.smartdoc_templates (tenant_id, name, type, default_context, status, folder_id, description, is_homeowner_visible, created_by)
SELECT 
  t.id,
  template.name,
  template.type::smartdoc_template_type,
  template.context::smartdoc_context_type,
  'PUBLISHED'::smartdoc_status,
  f.id,
  template.description,
  template.is_homeowner_visible,
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid
FROM (VALUES 
  ('Roof Replacement Proposal', 'DOCUMENT', 'ESTIMATE', 'Professional proposal for roof replacement projects', true, 'Proposals'),
  ('Storm Damage Assessment', 'DOCUMENT', 'PROJECT', 'Comprehensive storm damage evaluation report', true, 'Proposals'),
  ('Roofing Contract Agreement', 'DOCUMENT', 'PROJECT', 'Legal contract for roofing services', true, 'Contracts'),
  ('Change Order Form', 'DOCUMENT', 'PROJECT', 'Additional work authorization form', true, 'Change Orders'),
  ('Certificate of Completion', 'DOCUMENT', 'PROJECT', 'Project completion certificate', true, 'Completion Certificates'),
  ('Insurance Claim Support Letter', 'DOCUMENT', 'PROJECT', 'Letter supporting insurance claim process', false, 'Insurance Documents'),
  ('Roof Maintenance Guide', 'DOCUMENT', 'PROJECT', 'Customer roof maintenance instructions', true, 'Marketing Materials')
) AS template(name, type, context, description, is_homeowner_visible, folder_name)
CROSS JOIN public.tenants t
LEFT JOIN public.smartdoc_folders f ON f.name = template.folder_name AND f.tenant_id = t.id
WHERE t.name = 'O''Brien Contracting'
AND f.id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM public.smartdoc_templates 
  WHERE name = template.name AND tenant_id = t.id
);