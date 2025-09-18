-- SMART DOCS - Phase 3: Seed Data & Storage Setup
-- Insert global tag catalog for all contexts
INSERT INTO public.smartdoc_tag_catalog (name, description, example_value, context_type, is_sensitive, transform_support) VALUES
-- Contact tags
('contact.first_name', 'Contact first name', 'John', 'CONTACT', false, ARRAY['upper', 'title']),
('contact.last_name', 'Contact last name', 'Smith', 'CONTACT', false, ARRAY['upper', 'title']),
('contact.full_name', 'Contact full name', 'John Smith', 'CONTACT', false, ARRAY['upper', 'title']),
('contact.email', 'Contact email address', 'john.smith@email.com', 'CONTACT', false, ARRAY[]),
('contact.phone', 'Contact phone number', '(555) 123-4567', 'CONTACT', false, ARRAY['phone_us']),
('contact.company_name', 'Contact company name', 'ABC Construction', 'CONTACT', false, ARRAY[]),
('contact.address.street', 'Contact street address', '123 Main Street', 'CONTACT', false, ARRAY[]),
('contact.address.city', 'Contact city', 'Orlando', 'CONTACT', false, ARRAY[]),
('contact.address.state', 'Contact state', 'FL', 'CONTACT', false, ARRAY['upper']),
('contact.address.zip', 'Contact ZIP code', '32801', 'CONTACT', false, ARRAY[]),
('contact.address.full', 'Contact full address', '123 Main Street, Orlando, FL 32801', 'CONTACT', false, ARRAY[]),

-- Project tags
('project.name', 'Project name', 'Smith Roof Replacement', 'PROJECT', false, ARRAY[]),
('project.number', 'Project number', 'PROJ-2025-0001', 'PROJECT', false, ARRAY[]),
('project.status', 'Project status', 'Active', 'PROJECT', false, ARRAY['title']),
('project.start_date', 'Project start date', '2025-01-15', 'PROJECT', false, ARRAY['date']),
('project.completion_date', 'Project completion date', '2025-02-15', 'PROJECT', false, ARRAY['date']),
('project.description', 'Project description', 'Complete roof replacement with architectural shingles', 'PROJECT', false, ARRAY[]),

-- Estimate tags
('estimate.number', 'Estimate number', 'EST-2025-0001', 'ESTIMATE', false, ARRAY[]),
('estimate.selling_price', 'Estimate selling price', '15500.00', 'ESTIMATE', false, ARRAY['currency']),
('estimate.material_cost', 'Material costs', '8500.00', 'ESTIMATE', true, ARRAY['currency']),
('estimate.labor_cost', 'Labor costs', '4200.00', 'ESTIMATE', true, ARRAY['currency']),
('estimate.overhead_amount', 'Overhead amount', '1200.00', 'ESTIMATE', true, ARRAY['currency']),
('estimate.overhead_percent', 'Overhead percentage', '15.5', 'ESTIMATE', true, ARRAY['percent']),
('estimate.actual_profit', 'Actual profit', '1600.00', 'ESTIMATE', true, ARRAY['currency']),
('estimate.actual_margin_percent', 'Actual margin percentage', '25.8', 'ESTIMATE', true, ARRAY['percent']),
('estimate.target_margin_percent', 'Target margin percentage', '30.0', 'ESTIMATE', true, ARRAY['percent']),
('estimate.valid_until', 'Estimate valid until date', '2025-02-15', 'ESTIMATE', false, ARRAY['date']),
('estimate.created_date', 'Estimate created date', '2025-01-15', 'ESTIMATE', false, ARRAY['date']),

-- Company/branding tags
('company.name', 'Company name', 'O''Brien Contracting', 'PROJECT', false, ARRAY[]),
('company.license', 'Company license number', 'CCC1335947', 'PROJECT', false, ARRAY[]),
('company.phone', 'Company phone', '(407) 555-0100', 'PROJECT', false, ARRAY['phone_us']),
('company.email', 'Company email', 'info@obriencontracting.com', 'PROJECT', false, ARRAY[]),
('company.address', 'Company address', '456 Business Blvd, Orlando, FL 32801', 'PROJECT', false, ARRAY[]),
('company.website', 'Company website', 'www.obriencontracting.com', 'PROJECT', false, ARRAY[]);

-- Create storage bucket for Smart Docs assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'smartdoc-assets',
  'smartdoc-assets',
  false,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
);

-- Create storage bucket for rendered documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'smartdoc-renditions',
  'smartdoc-renditions',
  false,
  104857600, -- 100MB limit
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/html']
);

-- Storage policies for smartdoc-assets bucket
CREATE POLICY "Users can view assets in their tenant" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'smartdoc-assets' AND 
    (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

CREATE POLICY "Users can upload assets in their tenant" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'smartdoc-assets' AND 
    (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

CREATE POLICY "Users can update assets in their tenant" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'smartdoc-assets' AND 
    (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

CREATE POLICY "Users can delete assets in their tenant" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'smartdoc-assets' AND 
    (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

-- Storage policies for smartdoc-renditions bucket
CREATE POLICY "Users can view renditions in their tenant" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'smartdoc-renditions' AND 
    (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

CREATE POLICY "System can create renditions" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'smartdoc-renditions' AND 
    (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

-- Create sample folders for O'Brien Contracting
INSERT INTO public.smartdoc_folders (name, tenant_id, created_by)
SELECT 
  folder_name,
  t.id,
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid
FROM (VALUES 
  ('Proposals'),
  ('Contracts'), 
  ('Change Orders'),
  ('Insurance Documents'),
  ('Marketing Materials'),
  ('Legal Forms')
) AS folders(folder_name)
CROSS JOIN public.tenants t
WHERE t.name = 'O''Brien Contracting';

-- Create sample Smart Blocks
INSERT INTO public.smartdoc_blocks (name, description, block_type, content, tenant_id, created_by)
SELECT 
  block.name,
  block.description,
  block.block_type,
  block.content::jsonb,
  t.id,
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid
FROM (VALUES 
  ('Company Header', 'Standard company header with logo and contact info', 'header', '{"type": "header", "logo": true, "contact_info": true, "colors": {"primary": "#2E7D32", "secondary": "#FFB300"}}'),
  ('Company Footer', 'Standard company footer with license and legal info', 'footer', '{"type": "footer", "license": "{{ company.license }}", "legal": "Licensed and Insured"}'),
  ('Estimate Summary', 'Professional estimate summary table', 'estimate_table', '{"type": "table", "columns": ["description", "quantity", "unit_price", "total"], "show_totals": true}'),
  ('About Us', 'Company overview and credentials', 'about_us', '{"type": "content", "title": "About {{ company.name }}", "content": "Professional roofing contractor serving Central Florida since 2005. Licensed, bonded, and insured."}'),
  ('Warranty Information', 'Standard warranty terms', 'warranty', '{"type": "content", "title": "Warranty", "years": 25, "coverage": "materials and workmanship"}'),
  ('Payment Schedule', 'Standard payment terms', 'payment_terms', '{"type": "schedule", "terms": "50% deposit, 50% on completion", "methods": ["check", "credit_card", "financing"]}}')
) AS block(name, description, block_type, content)
CROSS JOIN public.tenants t
WHERE t.name = 'O''Brien Contracting';