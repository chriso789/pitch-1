-- RLS policy was already applied in previous migration attempt
-- Now just insert expanded smart tags (70+ new tags) without is_system column
INSERT INTO smart_tag_definitions (tag_key, category, description, data_source, field_path, format_type) VALUES
-- Contact Extended
('contact.company_name', 'Contact', 'Contact''s Company Name', 'contacts', 'company_name', 'text'),
('contact.secondary_phone', 'Contact', 'Secondary Phone Number', 'contacts', 'secondary_phone', 'phone'),
('contact.secondary_email', 'Contact', 'Secondary Email Address', 'contacts', 'secondary_email', 'text'),
('contact.lead_source', 'Contact', 'Lead Source', 'contacts', 'lead_source', 'text'),
('contact.lead_score', 'Contact', 'Lead Score', 'contacts', 'lead_score', 'number'),
('contact.qualification_status', 'Contact', 'Qualification Status', 'contacts', 'qualification_status', 'text'),
('contact.created_date', 'Contact', 'Contact Created Date', 'contacts', 'created_at', 'date'),
('contact.notes', 'Contact', 'Contact Notes', 'contacts', 'notes', 'text'),
('contact.county', 'Contact', 'Contact County', 'contacts', 'county', 'text'),

-- Company Extended
('company.website', 'Company', 'Company Website', 'tenants', 'website', 'text'),
('company.license_number', 'Company', 'Contractor License Number', 'tenants', 'license_number', 'text'),
('company.owner_name', 'Company', 'Company Owner Name', 'tenants', 'owner_name', 'text'),
('company.owner_phone', 'Company', 'Owner Phone Number', 'tenants', 'owner_phone', 'phone'),
('company.owner_email', 'Company', 'Owner Email', 'tenants', 'owner_email', 'text'),
('company.payment_terms', 'Company', 'Payment Terms', 'tenants', 'payment_terms', 'text'),
('company.warranty_info', 'Company', 'Warranty Information', 'tenants', 'warranty_info', 'text'),
('company.about_us', 'Company', 'About Us Description', 'tenants', 'about_us', 'text'),
('company.city', 'Company', 'Company City', 'tenants', 'city', 'text'),
('company.state', 'Company', 'Company State', 'tenants', 'state', 'text'),
('company.zip', 'Company', 'Company ZIP Code', 'tenants', 'zip', 'text'),

-- Project/Pipeline Extended
('project.estimated_value', 'Project', 'Estimated Project Value', 'pipeline_entries', 'estimated_value', 'currency'),
('project.expected_close_date', 'Project', 'Expected Close Date', 'pipeline_entries', 'expected_close_date', 'date'),
('project.priority', 'Project', 'Project Priority', 'pipeline_entries', 'priority', 'text'),
('project.roof_type', 'Project', 'Roof Type', 'pipeline_entries', 'roof_type', 'text'),
('project.lead_temperature', 'Project', 'Lead Temperature', 'pipeline_entries', 'lead_temperature', 'text'),
('project.lead_quality_score', 'Project', 'Lead Quality Score', 'pipeline_entries', 'lead_quality_score', 'number'),
('project.marketing_campaign', 'Project', 'Marketing Campaign Source', 'pipeline_entries', 'marketing_campaign', 'text'),
('project.qualification_notes', 'Project', 'Qualification Notes', 'pipeline_entries', 'qualification_notes', 'text'),
('project.notes', 'Project', 'Project Notes', 'pipeline_entries', 'notes', 'text'),
('project.created_date', 'Project', 'Project Created Date', 'pipeline_entries', 'created_at', 'date'),
('project.lead_number', 'Project', 'Lead Number', 'pipeline_entries', 'lead_number', 'text'),

-- Estimate Extended
('estimate.material_cost', 'Estimate', 'Material Cost', 'estimates', 'material_cost', 'currency'),
('estimate.labor_cost', 'Estimate', 'Labor Cost', 'estimates', 'labor_cost', 'currency'),
('estimate.overhead_amount', 'Estimate', 'Overhead Amount', 'estimates', 'overhead_amount', 'currency'),
('estimate.selling_price', 'Estimate', 'Selling Price', 'estimates', 'selling_price', 'currency'),
('estimate.profit', 'Estimate', 'Profit Amount', 'estimates', 'actual_profit', 'currency'),
('estimate.margin_percent', 'Estimate', 'Profit Margin %', 'estimates', 'actual_margin_percent', 'number'),
('estimate.valid_until', 'Estimate', 'Valid Until Date', 'estimates', 'valid_until', 'date'),
('estimate.status', 'Estimate', 'Estimate Status', 'estimates', 'status', 'text'),
('estimate.sent_date', 'Estimate', 'Sent Date', 'estimates', 'sent_at', 'date'),
('estimate.approved_date', 'Estimate', 'Approved Date', 'estimates', 'approved_at', 'date'),
('estimate.created_date', 'Estimate', 'Estimate Created Date', 'estimates', 'created_at', 'date'),
('estimate.overhead_percent', 'Estimate', 'Overhead %', 'estimates', 'overhead_percent', 'number'),
('estimate.target_margin', 'Estimate', 'Target Margin %', 'estimates', 'target_margin_percent', 'number'),
('estimate.financing_option', 'Estimate', 'Financing Option', 'estimates', 'financing_option', 'text'),
('estimate.monthly_payment', 'Estimate', 'Monthly Payment', 'estimates', 'monthly_payment', 'currency'),

-- Measurements
('measurement.total_sqft', 'Measurement', 'Total Roof Square Feet', 'measurements', 'total_roof_area', 'number'),
('measurement.total_squares', 'Measurement', 'Total Squares', 'measurements', 'total_squares', 'number'),
('measurement.ridge_lf', 'Measurement', 'Ridge Linear Feet', 'measurements', 'ridge_length', 'number'),
('measurement.hip_lf', 'Measurement', 'Hip Linear Feet', 'measurements', 'hip_length', 'number'),
('measurement.valley_lf', 'Measurement', 'Valley Linear Feet', 'measurements', 'valley_length', 'number'),
('measurement.eave_lf', 'Measurement', 'Eave Linear Feet', 'measurements', 'eave_length', 'number'),
('measurement.rake_lf', 'Measurement', 'Rake Linear Feet', 'measurements', 'rake_length', 'number'),
('measurement.predominant_pitch', 'Measurement', 'Predominant Pitch', 'measurements', 'predominant_pitch', 'text'),
('measurement.total_facets', 'Measurement', 'Number of Roof Faces', 'measurements', 'total_facets', 'number'),
('measurement.source', 'Measurement', 'Measurement Source', 'measurements', 'imagery_source', 'text'),

-- Sales Rep
('rep.name', 'Sales Rep', 'Sales Rep Full Name', 'profiles', 'full_name', 'text'),
('rep.first_name', 'Sales Rep', 'Sales Rep First Name', 'profiles', 'first_name', 'text'),
('rep.last_name', 'Sales Rep', 'Sales Rep Last Name', 'profiles', 'last_name', 'text'),
('rep.email', 'Sales Rep', 'Sales Rep Email', 'profiles', 'email', 'text'),
('rep.phone', 'Sales Rep', 'Sales Rep Phone', 'profiles', 'phone', 'phone'),
('rep.title', 'Sales Rep', 'Sales Rep Title', 'profiles', 'title', 'text'),

-- Date/Time
('today.time', 'Date', 'Current Time', 'system', 'current_time', 'text'),
('today.year', 'Date', 'Current Year', 'system', 'current_year', 'text'),
('today.month', 'Date', 'Current Month Name', 'system', 'current_month', 'text'),
('today.day', 'Date', 'Current Day Number', 'system', 'current_day', 'text'),
('today.weekday', 'Date', 'Current Weekday Name', 'system', 'current_weekday', 'text'),

-- Insurance
('insurance.claim_number', 'Insurance', 'Insurance Claim Number', 'pipeline_entries', 'insurance_claim_number', 'text'),
('insurance.carrier', 'Insurance', 'Insurance Carrier', 'pipeline_entries', 'insurance_carrier', 'text'),
('insurance.adjuster_name', 'Insurance', 'Adjuster Name', 'pipeline_entries', 'adjuster_name', 'text'),
('insurance.adjuster_phone', 'Insurance', 'Adjuster Phone', 'pipeline_entries', 'adjuster_phone', 'phone'),
('insurance.date_of_loss', 'Insurance', 'Date of Loss', 'pipeline_entries', 'date_of_loss', 'date'),
('insurance.deductible', 'Insurance', 'Deductible Amount', 'pipeline_entries', 'deductible', 'currency')

ON CONFLICT (tag_key) DO NOTHING;