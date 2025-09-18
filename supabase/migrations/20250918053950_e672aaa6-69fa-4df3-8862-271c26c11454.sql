-- SMART DOCS Database Schema - Phase 3: Indexes, Triggers & Sample Data

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_smartdoc_templates_tenant_id ON public.smartdoc_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_smartdoc_templates_status ON public.smartdoc_templates(status);
CREATE INDEX IF NOT EXISTS idx_smartdoc_template_versions_template_id ON public.smartdoc_template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_smartdoc_template_versions_is_latest ON public.smartdoc_template_versions(is_latest);
CREATE INDEX IF NOT EXISTS idx_smartdoc_blocks_tenant_id ON public.smartdoc_blocks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_smartdoc_blocks_type ON public.smartdoc_blocks(block_type);
CREATE INDEX IF NOT EXISTS idx_smartdoc_assets_tenant_id ON public.smartdoc_assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_smartdoc_assets_hash ON public.smartdoc_assets(hash);
CREATE INDEX IF NOT EXISTS idx_smartdoc_tag_catalog_context ON public.smartdoc_tag_catalog(context_type);
CREATE INDEX IF NOT EXISTS idx_smartdoc_renditions_tenant_id ON public.smartdoc_renditions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_smartdoc_renditions_template_id ON public.smartdoc_renditions(template_id);
CREATE INDEX IF NOT EXISTS idx_smartdoc_renditions_context ON public.smartdoc_renditions(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_smartdoc_sign_envelopes_tenant_id ON public.smartdoc_sign_envelopes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_smartdoc_sign_envelopes_rendition_id ON public.smartdoc_sign_envelopes(rendition_id);
CREATE INDEX IF NOT EXISTS idx_smartdoc_share_rules_tenant_id ON public.smartdoc_share_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_smartdoc_folders_tenant_id ON public.smartdoc_folders(tenant_id);

-- Add updated_at triggers for tables that need them
CREATE TRIGGER update_smartdoc_templates_updated_at
  BEFORE UPDATE ON public.smartdoc_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_smartdoc_blocks_updated_at
  BEFORE UPDATE ON public.smartdoc_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_smartdoc_sign_envelopes_updated_at
  BEFORE UPDATE ON public.smartdoc_sign_envelopes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
('project.roof_type', 'Type of roof', 'Asphalt Shingle', 'PROJECT', false, ARRAY['title']),
('project.roof_color', 'Roof color', 'Charcoal', 'PROJECT', false, ARRAY['title']),

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
('rep.email', 'Rep email address', 'chris@obriencontracting.com', 'ESTIMATE', false, ARRAY['lower']),

-- Computed helpers (non-sensitive)
('profit.gross', 'Gross profit amount', '$2,000.00', 'ESTIMATE', false, ARRAY['currency']),
('profit.margin_pct', 'Profit margin percentage', '12.7%', 'ESTIMATE', false, ARRAY['percent'])

ON CONFLICT (name, context_type) DO NOTHING;