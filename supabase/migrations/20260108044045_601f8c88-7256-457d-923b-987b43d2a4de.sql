-- Add roofing-specific smart tag definitions
INSERT INTO smart_tag_definitions (tag_key, category, data_source, field_path, format_type, description, default_value)
VALUES
  -- Roofing measurements
  ('roof.total_area', 'ROOFING', 'measurements', 'summary.total_area', 'number', 'Total roof area in sq ft', 'TBD'),
  ('roof.pitch', 'ROOFING', 'measurements', 'summary.predominant_pitch', 'text', 'Primary roof pitch', 'TBD'),
  ('roof.faces_count', 'ROOFING', 'measurements', 'summary.face_count', 'number', 'Number of roof faces', ''),
  
  -- Company branding
  ('company.logo_url', 'COMPANY', 'tenants', 'logo_url', 'text', 'Company logo URL', ''),
  ('company.website', 'COMPANY', 'tenants', 'website', 'text', 'Company website', ''),
  ('company.license', 'COMPANY', 'tenants', 'license_number', 'text', 'Contractor license number', 'Licensed & Insured'),
  ('company.about', 'COMPANY', 'tenants', 'about_us', 'text', 'Company about text', ''),
  ('company.warranty_terms', 'COMPANY', 'tenants', 'warranty_terms', 'text', 'Warranty terms', ''),
  ('company.payment_terms', 'COMPANY', 'tenants', 'payment_terms', 'text', 'Payment terms', ''),
  
  -- Estimate details
  ('estimate.selling_price', 'ESTIMATE', 'estimates', 'selling_price', 'currency', 'Total selling price', '$0.00'),
  ('estimate.material_cost', 'ESTIMATE', 'estimates', 'material_cost', 'currency', 'Material cost', '$0.00'),
  ('estimate.labor_cost', 'ESTIMATE', 'estimates', 'labor_cost', 'currency', 'Labor cost', '$0.00')
ON CONFLICT (tag_key) DO UPDATE SET
  category = EXCLUDED.category,
  data_source = EXCLUDED.data_source,
  field_path = EXCLUDED.field_path,
  format_type = EXCLUDED.format_type,
  description = EXCLUDED.description,
  default_value = EXCLUDED.default_value;

-- Create Professional Roofing Proposal template
INSERT INTO presentation_templates (
  name, 
  description, 
  vertical, 
  is_active,
  slide_count
)
VALUES (
  'Professional Roofing Proposal',
  'Complete roofing sales presentation with company branding, project photos, scope of work, pricing, warranty, and next steps',
  'roofing',
  true,
  10
)
ON CONFLICT DO NOTHING;

-- Get the template ID and insert slides
DO $$
DECLARE
  v_template_id UUID;
BEGIN
  SELECT id INTO v_template_id FROM presentation_templates WHERE name = 'Professional Roofing Proposal' LIMIT 1;
  
  IF v_template_id IS NOT NULL THEN
    -- Delete existing slides for this template to avoid duplicates
    DELETE FROM presentation_template_slides WHERE template_id = v_template_id;
    
    -- Insert template slides
    INSERT INTO presentation_template_slides (template_id, slide_order, slide_type, title, content_template, ai_prompt, media_type, is_required)
    VALUES
    -- Slide 1: Title
    (v_template_id, 1, 'title', '{{company.name}}', 
     '{"heading": "Roofing Proposal", "subtitle": "Prepared for {{customer.name}}", "address": "{{customer.address}}, {{customer.city}}, {{customer.state}}", "logo": "{{company.logo_url}}"}'::jsonb,
     NULL, 'logo', true),
    
    -- Slide 2: About Us
    (v_template_id, 2, 'about_us', 'About {{company.name}}',
     '{"logo": "{{company.logo_url}}", "license": "{{company.license}}", "phone": "{{company.phone}}", "website": "{{company.website}}"}'::jsonb,
     'Write a compelling 2-3 paragraph introduction about {{company.name}}. Highlight our expertise in roofing, years of experience, commitment to quality, and customer satisfaction. Make it professional and trustworthy.',
     NULL, true),
    
    -- Slide 3: Property Overview (Photos)
    (v_template_id, 3, 'photo_gallery', 'Your Property',
     '{"description": "Property at {{customer.address}}"}'::jsonb,
     NULL, 'gallery', true),
    
    -- Slide 4: Scope of Work
    (v_template_id, 4, 'scope_of_work', 'Scope of Work',
     '{"content": "{{ai_generated_scope}}"}'::jsonb,
     'Based on our inspection of the property at {{customer.address}}, write a detailed scope of work for the roofing project. Include: tear-off of existing materials, deck inspection and repairs, installation of underlayment, new shingle installation, flashing work, cleanup, and final inspection. Be specific and professional.',
     NULL, true),
    
    -- Slide 5: Materials
    (v_template_id, 5, 'materials', 'Premium Materials',
     '{"material_list": "{{roofing.material_list}}"}'::jsonb,
     'Describe the premium roofing materials we will use for this project. Emphasize quality, durability, manufacturer warranties, and aesthetic appeal. Include specific product names and benefits if available.',
     NULL, true),
    
    -- Slide 6: Pricing
    (v_template_id, 6, 'pricing', 'Your Investment',
     '{"scope": "Complete Roof Replacement", "materials": "{{estimate.material_cost}}", "labor": "{{estimate.labor_cost}}", "total": "{{estimate.selling_price}}", "payment_terms": "{{company.payment_terms}}"}'::jsonb,
     NULL, NULL, true),
    
    -- Slide 7: Warranty
    (v_template_id, 7, 'warranty', 'Our Warranty',
     '{"warranty_years": "{{roofing.warranty_years}}"}'::jsonb,
     'Explain our comprehensive warranty coverage. Include workmanship warranty details, manufacturer product warranty, what is covered, and how to make a warranty claim. Emphasize peace of mind and long-term protection.',
     NULL, true),
    
    -- Slide 8: Timeline
    (v_template_id, 8, 'timeline', 'Project Timeline',
     '{}'::jsonb,
     'Outline a typical roofing project timeline from contract signing to completion. Include: permit acquisition (if needed), material ordering, project start date, expected duration, and final walkthrough. Be realistic and set proper expectations.',
     NULL, false),
    
    -- Slide 9: Financing
    (v_template_id, 9, 'financing', 'Financing Options',
     '{}'::jsonb,
     'Describe flexible financing options available for homeowners. Include monthly payment examples, 0% interest options if applicable, and how to apply. Make it easy for customers to afford their new roof.',
     NULL, false),
    
    -- Slide 10: Next Steps
    (v_template_id, 10, 'next_steps', 'Ready to Get Started?',
     '{"phone": "{{company.phone}}", "email": "{{company.email}}"}'::jsonb,
     'Write a compelling call to action. Encourage the homeowner to move forward with the project. Mention limited-time offers, scheduling availability, and the next steps to get started. Create urgency while remaining professional.',
     NULL, true);
  END IF;
END $$;