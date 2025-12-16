-- =============================================
-- AI Smart Presentations System
-- =============================================

-- Smart Tag Definitions (extensible tag registry)
CREATE TABLE IF NOT EXISTS smart_tag_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT,
  data_source TEXT NOT NULL,
  field_path TEXT NOT NULL,
  default_value TEXT,
  format_type TEXT DEFAULT 'text',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE smart_tag_definitions ENABLE ROW LEVEL SECURITY;

-- Anyone can read tag definitions
CREATE POLICY "Anyone can read smart tag definitions"
ON smart_tag_definitions FOR SELECT
TO authenticated
USING (true);

-- Only master can manage
CREATE POLICY "Master can manage smart tag definitions"
ON smart_tag_definitions FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'master'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'master'));

-- Seed CRM-related smart tags
INSERT INTO smart_tag_definitions (tag_key, category, description, data_source, field_path, format_type) VALUES
-- Customer Tags
('customer.name', 'CUSTOMER', 'Full customer name', 'contacts', 'first_name || '' '' || last_name', 'text'),
('customer.first_name', 'CUSTOMER', 'Customer first name', 'contacts', 'first_name', 'text'),
('customer.last_name', 'CUSTOMER', 'Customer last name', 'contacts', 'last_name', 'text'),
('customer.phone', 'CUSTOMER', 'Customer phone', 'contacts', 'phone', 'phone'),
('customer.email', 'CUSTOMER', 'Customer email', 'contacts', 'email', 'text'),
('customer.address', 'CUSTOMER', 'Property address', 'contacts', 'address_line1', 'text'),
('customer.city', 'CUSTOMER', 'City', 'contacts', 'city', 'text'),
('customer.state', 'CUSTOMER', 'State', 'contacts', 'state', 'text'),
('customer.zip', 'CUSTOMER', 'ZIP code', 'contacts', 'zip_code', 'text'),
-- Company Tags
('company.name', 'COMPANY', 'Company name', 'tenants', 'tenant_name', 'text'),
('company.phone', 'COMPANY', 'Company phone', 'tenants', 'phone', 'phone'),
('company.email', 'COMPANY', 'Company email', 'tenants', 'email', 'text'),
('company.address', 'COMPANY', 'Company address', 'tenants', 'address', 'text'),
('company.license', 'COMPANY', 'License number', 'tenants', 'license_number', 'text'),
('company.about', 'COMPANY', 'Company description', 'tenants', 'about_us', 'text'),
('company.warranty', 'COMPANY', 'Warranty terms', 'tenants', 'warranty_terms', 'text'),
-- Project Tags
('project.name', 'PROJECT', 'Project name', 'pipeline_entries', 'title', 'text'),
('project.type', 'PROJECT', 'Project type', 'pipeline_entries', 'job_type', 'text'),
('project.status', 'PROJECT', 'Project status', 'pipeline_entries', 'status', 'text'),
('project.start_date', 'PROJECT', 'Start date', 'pipeline_entries', 'expected_start_date', 'date'),
('project.description', 'PROJECT', 'Project description', 'pipeline_entries', 'description', 'text'),
-- Estimate Tags
('estimate.total', 'ESTIMATE', 'Total estimate', 'estimates', 'total_amount', 'currency'),
('estimate.subtotal', 'ESTIMATE', 'Subtotal', 'estimates', 'subtotal', 'currency'),
('estimate.tax', 'ESTIMATE', 'Tax amount', 'estimates', 'tax_amount', 'currency'),
('estimate.materials', 'ESTIMATE', 'Materials cost', 'estimates', 'materials_total', 'currency'),
('estimate.labor', 'ESTIMATE', 'Labor cost', 'estimates', 'labor_total', 'currency'),
-- Roof Measurement Tags
('roof.total_sqft', 'MEASUREMENTS', 'Total roof area in sq ft', 'measurements', 'total_area_sqft', 'number'),
('roof.squares', 'MEASUREMENTS', 'Total roof squares', 'measurements', 'total_squares', 'number'),
('roof.pitch', 'MEASUREMENTS', 'Roof pitch', 'measurements', 'pitch', 'text'),
('roof.stories', 'MEASUREMENTS', 'Number of stories', 'measurements', 'stories', 'number'),
('roof.perimeter', 'MEASUREMENTS', 'Roof perimeter in ft', 'measurements', 'perimeter_ft', 'number'),
('roof.waste_pct', 'MEASUREMENTS', 'Waste percentage', 'measurements', 'waste_pct', 'number')
ON CONFLICT (tag_key) DO NOTHING;

-- Presentation Templates (vertical-specific blueprints)
CREATE TABLE IF NOT EXISTS presentation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  vertical TEXT NOT NULL,
  thumbnail_url TEXT,
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  slide_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE presentation_templates ENABLE ROW LEVEL SECURITY;

-- Users can view system templates and their tenant's templates
CREATE POLICY "Users can view templates"
ON presentation_templates FOR SELECT
TO authenticated
USING (is_system = true OR tenant_id = get_user_tenant_id());

-- Admins can manage their tenant's templates
CREATE POLICY "Admins can manage templates"
ON presentation_templates FOR ALL
TO authenticated
USING (
  tenant_id = get_user_tenant_id() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('master', 'corporate', 'office_admin'))
)
WITH CHECK (
  tenant_id = get_user_tenant_id() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('master', 'corporate', 'office_admin'))
);

-- Template Slide Definitions (blueprints for each slide)
CREATE TABLE IF NOT EXISTS presentation_template_slides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES presentation_templates(id) ON DELETE CASCADE,
  slide_order INTEGER NOT NULL,
  slide_type TEXT NOT NULL,
  title TEXT,
  content_template JSONB NOT NULL DEFAULT '{}',
  ai_prompt TEXT,
  media_type TEXT,
  media_source TEXT,
  is_required BOOLEAN DEFAULT true,
  skip_if_empty TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE presentation_template_slides ENABLE ROW LEVEL SECURITY;

-- Users can view slides for accessible templates
CREATE POLICY "Users can view template slides"
ON presentation_template_slides FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM presentation_templates pt
    WHERE pt.id = template_id
    AND (pt.is_system = true OR pt.tenant_id = get_user_tenant_id())
  )
);

-- Company Credentials (certifications, licenses, awards)
CREATE TABLE IF NOT EXISTS company_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_url TEXT,
  credential_type TEXT NOT NULL,
  expiration_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE company_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their company credentials"
ON company_credentials FOR SELECT
TO authenticated
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage company credentials"
ON company_credentials FOR ALL
TO authenticated
USING (
  tenant_id = get_user_tenant_id() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('master', 'corporate', 'office_admin'))
)
WITH CHECK (
  tenant_id = get_user_tenant_id() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('master', 'corporate', 'office_admin'))
);

-- Add branding columns to tenants if not exists
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS about_us TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS warranty_terms TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_terms TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_number TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS insurance_info TEXT;

-- Add AI generation tracking to presentations
ALTER TABLE presentations ADD COLUMN IF NOT EXISTS generation_mode TEXT;
ALTER TABLE presentations ADD COLUMN IF NOT EXISTS generation_status TEXT DEFAULT 'draft';
ALTER TABLE presentations ADD COLUMN IF NOT EXISTS source_template_id UUID REFERENCES presentation_templates(id);
ALTER TABLE presentations ADD COLUMN IF NOT EXISTS pipeline_entry_id UUID REFERENCES pipeline_entries(id);
ALTER TABLE presentations ADD COLUMN IF NOT EXISTS missing_data JSONB DEFAULT '[]';

-- Seed system templates
INSERT INTO presentation_templates (id, name, description, vertical, is_system, is_active, slide_count)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Residential Roofing Sales Deck', 'Professional sales presentation for residential roofing projects with roof metrics, estimates, and photos', 'residential_roofing', true, true, 7),
  ('22222222-2222-2222-2222-222222222222', 'Commercial Roofing Sales Deck', 'Comprehensive commercial roofing presentation with ROI analysis and maintenance plans', 'commercial_roofing', true, true, 9),
  ('33333333-3333-3333-3333-333333333333', 'Home Services Sales Deck', 'Versatile presentation template for HVAC, windows, painting, and other home services', 'home_services', true, true, 6)
ON CONFLICT DO NOTHING;

-- Seed Residential Roofing Template Slides
INSERT INTO presentation_template_slides (template_id, slide_order, slide_type, title, content_template, ai_prompt, media_type, media_source, is_required)
VALUES
  ('11111111-1111-1111-1111-111111111111', 1, 'title', 'Title Slide', 
   '{"heading": "{{project.name}}", "subheading": "{{customer.name}}", "address": "{{customer.address}}, {{customer.city}}, {{customer.state}} {{customer.zip}}", "date": "{{today}}"}'::jsonb,
   NULL, 'company_logo', 'tenant.logo_url', true),
  ('11111111-1111-1111-1111-111111111111', 2, 'content', 'About Us',
   '{"heading": "About {{company.name}}", "content": "{{company.about}}", "license": "License #{{company.license}}"}'::jsonb,
   'Write a compelling 2-3 sentence company introduction for a roofing contractor named {{company.name}}. Focus on experience, quality, and customer satisfaction.',
   'credentials', 'company_credentials', true),
  ('11111111-1111-1111-1111-111111111111', 3, 'content', 'Scope of Work',
   '{"heading": "Scope of Work", "content": "{{ai_generated_scope}}"}'::jsonb,
   'Write 4-5 professional bullet points describing the scope of work for a {{project.type}} project at {{customer.address}}. Include material removal, installation, cleanup, and warranty information.',
   NULL, NULL, true),
  ('11111111-1111-1111-1111-111111111111', 4, 'metrics', 'Your Roof Metrics',
   '{"heading": "Your Roof Measurements", "metrics": [{"label": "Total Area", "value": "{{roof.total_sqft}} sq ft"}, {"label": "Roof Squares", "value": "{{roof.squares}}"}, {"label": "Pitch", "value": "{{roof.pitch}}"}, {"label": "Stories", "value": "{{roof.stories}}"}]}'::jsonb,
   NULL, 'roof_diagram', 'measurements.diagram_url', false),
  ('11111111-1111-1111-1111-111111111111', 5, 'estimate', 'Investment Summary',
   '{"heading": "Your Investment", "total": "{{estimate.total}}", "breakdown": [{"label": "Materials", "value": "{{estimate.materials}}"}, {"label": "Labor", "value": "{{estimate.labor}}"}]}'::jsonb,
   'Write a brief 2-sentence explanation of the value this roofing investment provides, mentioning quality materials and workmanship warranty.',
   NULL, NULL, true),
  ('11111111-1111-1111-1111-111111111111', 6, 'gallery', 'Project Photos',
   '{"heading": "Project Documentation"}'::jsonb,
   NULL, 'photo_gallery', 'pipeline_entry.photos', false),
  ('11111111-1111-1111-1111-111111111111', 7, 'closing', 'Terms & Next Steps',
   '{"heading": "Next Steps", "warranty": "{{company.warranty}}", "payment_terms": "{{company.payment_terms}}", "cta": "Sign below to approve and schedule your project"}'::jsonb,
   NULL, 'signature', NULL, true)
ON CONFLICT DO NOTHING;

-- Seed Commercial Roofing Template Slides (abbreviated - key slides)
INSERT INTO presentation_template_slides (template_id, slide_order, slide_type, title, content_template, ai_prompt, is_required)
VALUES
  ('22222222-2222-2222-2222-222222222222', 1, 'title', 'Title Slide',
   '{"heading": "Commercial Roofing Proposal", "subheading": "{{customer.name}}", "address": "{{customer.address}}"}'::jsonb, NULL, true),
  ('22222222-2222-2222-2222-222222222222', 2, 'content', 'Company Overview',
   '{"heading": "About {{company.name}}"}'::jsonb,
   'Write a professional company overview for commercial roofing clients. Emphasize commercial experience, large-scale project capability, and industry certifications.', true),
  ('22222222-2222-2222-2222-222222222222', 3, 'metrics', 'Building Assessment',
   '{"heading": "Roof Assessment", "metrics": []}'::jsonb, NULL, true),
  ('22222222-2222-2222-2222-222222222222', 4, 'content', 'Recommended Solution',
   '{"heading": "Our Recommendation"}'::jsonb,
   'Write a professional recommendation for a commercial roof replacement or repair. Include material options and their benefits.', true),
  ('22222222-2222-2222-2222-222222222222', 5, 'estimate', 'Investment & ROI',
   '{"heading": "Investment Analysis"}'::jsonb, NULL, true),
  ('22222222-2222-2222-2222-222222222222', 6, 'content', 'Maintenance Plan',
   '{"heading": "Preventive Maintenance Program"}'::jsonb,
   'Write 3-4 bullet points about a preventive maintenance program for commercial roofs, including inspection frequency and benefits.', false),
  ('22222222-2222-2222-2222-222222222222', 7, 'gallery', 'Portfolio',
   '{"heading": "Similar Projects"}'::jsonb, NULL, false),
  ('22222222-2222-2222-2222-222222222222', 8, 'content', 'Timeline',
   '{"heading": "Project Timeline"}'::jsonb, NULL, true),
  ('22222222-2222-2222-2222-222222222222', 9, 'closing', 'Next Steps',
   '{"heading": "Ready to Proceed?"}'::jsonb, NULL, true)
ON CONFLICT DO NOTHING;

-- Seed Home Services Template Slides
INSERT INTO presentation_template_slides (template_id, slide_order, slide_type, title, content_template, ai_prompt, is_required)
VALUES
  ('33333333-3333-3333-3333-333333333333', 1, 'title', 'Title Slide',
   '{"heading": "{{project.type}} Proposal", "subheading": "For {{customer.name}}"}'::jsonb, NULL, true),
  ('33333333-3333-3333-3333-333333333333', 2, 'content', 'The Challenge',
   '{"heading": "Understanding Your Needs"}'::jsonb,
   'Write a brief empathetic description of the customer''s home service needs based on the project type: {{project.type}}. Focus on pain points and desired outcomes.', true),
  ('33333333-3333-3333-3333-333333333333', 3, 'content', 'Our Solution',
   '{"heading": "How We Can Help"}'::jsonb,
   'Write 3-4 bullet points describing the proposed solution for this {{project.type}} project. Emphasize quality, efficiency, and customer benefits.', true),
  ('33333333-3333-3333-3333-333333333333', 4, 'estimate', 'Your Investment',
   '{"heading": "Investment Summary"}'::jsonb, NULL, true),
  ('33333333-3333-3333-3333-333333333333', 5, 'gallery', 'Our Work',
   '{"heading": "Quality You Can Trust"}'::jsonb, NULL, false),
  ('33333333-3333-3333-3333-333333333333', 6, 'closing', 'Let''s Get Started',
   '{"heading": "Ready to Transform Your Home?"}'::jsonb, NULL, true)
ON CONFLICT DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_presentation_templates_vertical ON presentation_templates(vertical);
CREATE INDEX IF NOT EXISTS idx_presentation_templates_tenant ON presentation_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_presentation_template_slides_template ON presentation_template_slides(template_id);
CREATE INDEX IF NOT EXISTS idx_smart_tag_definitions_category ON smart_tag_definitions(category);
CREATE INDEX IF NOT EXISTS idx_company_credentials_tenant ON company_credentials(tenant_id);