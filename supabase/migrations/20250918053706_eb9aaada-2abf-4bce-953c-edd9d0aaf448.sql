-- SMART DOCS - Phase 3: Seed Data & Storage Setup (Fixed)
-- Insert global tag catalog for all contexts
INSERT INTO public.smartdoc_tag_catalog (name, description, example_value, context_type, is_sensitive, transform_support) VALUES
-- Contact tags
('contact.first_name', 'Contact first name', 'John', 'CONTACT', false, ARRAY['upper', 'title']),
('contact.last_name', 'Contact last name', 'Smith', 'CONTACT', false, ARRAY['upper', 'title']),
('contact.full_name', 'Contact full name', 'John Smith', 'CONTACT', false, ARRAY['upper', 'title']),
('contact.email', 'Contact email address', 'john.smith@email.com', 'CONTACT', false, ARRAY[]::TEXT[]),
('contact.phone', 'Contact phone number', '(555) 123-4567', 'CONTACT', false, ARRAY['phone_us']),
('contact.company_name', 'Contact company name', 'ABC Construction', 'CONTACT', false, ARRAY[]::TEXT[]),
('contact.address.street', 'Contact street address', '123 Main Street', 'CONTACT', false, ARRAY[]::TEXT[]),
('contact.address.city', 'Contact city', 'Orlando', 'CONTACT', false, ARRAY[]::TEXT[]),
('contact.address.state', 'Contact state', 'FL', 'CONTACT', false, ARRAY['upper']),
('contact.address.zip', 'Contact ZIP code', '32801', 'CONTACT', false, ARRAY[]::TEXT[]),
('contact.address.full', 'Contact full address', '123 Main Street, Orlando, FL 32801', 'CONTACT', false, ARRAY[]::TEXT[]),

-- Project tags
('project.name', 'Project name', 'Smith Roof Replacement', 'PROJECT', false, ARRAY[]::TEXT[]),
('project.number', 'Project number', 'PROJ-2025-0001', 'PROJECT', false, ARRAY[]::TEXT[]),
('project.status', 'Project status', 'Active', 'PROJECT', false, ARRAY['title']),
('project.start_date', 'Project start date', '2025-01-15', 'PROJECT', false, ARRAY['date']),
('project.completion_date', 'Project completion date', '2025-02-15', 'PROJECT', false, ARRAY['date']),
('project.description', 'Project description', 'Complete roof replacement with architectural shingles', 'PROJECT', false, ARRAY[]::TEXT[]),

-- Estimate tags
('estimate.number', 'Estimate number', 'EST-2025-0001', 'ESTIMATE', false, ARRAY[]::TEXT[]),
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
('company.name', 'Company name', 'O''Brien Contracting', 'PROJECT', false, ARRAY[]::TEXT[]),
('company.license', 'Company license number', 'CCC1335947', 'PROJECT', false, ARRAY[]::TEXT[]),
('company.phone', 'Company phone', '(407) 555-0100', 'PROJECT', false, ARRAY['phone_us']),
('company.email', 'Company email', 'info@obriencontracting.com', 'PROJECT', false, ARRAY[]::TEXT[]),
('company.address', 'Company address', '456 Business Blvd, Orlando, FL 32801', 'PROJECT', false, ARRAY[]::TEXT[]),
('company.website', 'Company website', 'www.obriencontracting.com', 'PROJECT', false, ARRAY[]::TEXT[]);

-- Create storage bucket for Smart Docs assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'smartdoc-assets',
  'smartdoc-assets',
  false,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
) ON CONFLICT (id) DO NOTHING;

-- Create storage bucket for rendered documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'smartdoc-renditions',
  'smartdoc-renditions',
  false,
  104857600, -- 100MB limit
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/html']
) ON CONFLICT (id) DO NOTHING;