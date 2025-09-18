-- SMART DOCS Sample Data - Simple Insert
-- Add unique constraint for tag catalog if it doesn't exist
ALTER TABLE public.smartdoc_tag_catalog ADD CONSTRAINT IF NOT EXISTS unique_tag_context UNIQUE (name, context_type);

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
('estimate.created_date', 'Estimate creation date', '2025-01-15', 'ESTIMATE', false, ARRAY['date']),
('estimate.valid_until', 'Estimate expiration date', '2025-02-15', 'ESTIMATE', false, ARRAY['date']),

-- Company/Rep tags
('company.name', 'Company name', 'O''Brien Contracting', 'PROJECT', false, NULL),
('company.license', 'License number', 'CCC1335947', 'PROJECT', false, NULL),
('company.phone', 'Company phone', '(555) 123-ROOF', 'PROJECT', false, ARRAY['phone_us']),
('rep.name', 'Sales representative name', 'Chris O''Brien', 'ESTIMATE', false, ARRAY['title']),
('rep.phone', 'Rep phone number', '(555) 123-4567', 'ESTIMATE', false, ARRAY['phone_us'])

ON CONFLICT (name, context_type) DO NOTHING;