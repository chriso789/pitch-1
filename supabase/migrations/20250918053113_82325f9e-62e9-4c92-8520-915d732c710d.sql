-- Add sample data for dialer functionality
-- Insert sample dispositions
INSERT INTO public.dialer_dispositions (name, description, is_positive, tenant_id, created_by) 
SELECT 
  disposition.name,
  disposition.description,
  disposition.is_positive,
  t.id,
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid
FROM (VALUES 
  ('Interested', 'Customer showed interest in services', true),
  ('Not Interested', 'Customer not interested at this time', false),
  ('Call Back Later', 'Customer requested to be called back', true),
  ('Wrong Number', 'Invalid or incorrect phone number', false),
  ('Voicemail', 'Left voicemail message', true),
  ('Appointment Set', 'Scheduled appointment for estimate', true),
  ('Not Available', 'Customer was not available to talk', false),
  ('Busy', 'Customer was busy, try again later', false)
) AS disposition(name, description, is_positive)
CROSS JOIN public.tenants t
WHERE t.name = 'O''Brien Contracting'
AND NOT EXISTS (
  SELECT 1 FROM public.dialer_dispositions 
  WHERE name = disposition.name AND tenant_id = t.id
);

-- Insert sample contact lists
INSERT INTO public.dialer_lists (name, description, tenant_id, created_by, total_items)
SELECT 
  list.name,
  list.description,
  t.id, 
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid,
  list.total_items
FROM (VALUES 
  ('Storm Damage Leads', 'Customers interested in storm damage repairs', 45),
  ('Roof Inspection Follow-ups', 'Customers who had roof inspections', 23),
  ('Gutter Maintenance', 'Seasonal gutter cleaning prospects', 67),
  ('New Construction', 'New construction roofing leads', 12),
  ('Insurance Claims', 'Insurance claim assistance leads', 34)
) AS list(name, description, total_items)
CROSS JOIN public.tenants t
WHERE t.name = 'O''Brien Contracting'
AND NOT EXISTS (
  SELECT 1 FROM public.dialer_lists 
  WHERE name = list.name AND tenant_id = t.id
);

-- Insert sample campaigns
INSERT INTO public.dialer_campaigns (name, description, status, list_id, tenant_id, created_by)
SELECT 
  campaign.name,
  campaign.description,
  'draft',
  dl.id,
  t.id,
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid
FROM (VALUES 
  ('Roof Inspections', 'Follow up on roof inspection leads', 'Roof Inspection Follow-ups'),
  ('Storm Damage Follow-up', 'Contact customers about storm damage repairs', 'Storm Damage Leads'),
  ('Gutter Cleaning', 'Seasonal gutter cleaning outreach', 'Gutter Maintenance'),
  ('Insurance Claim Support', 'Help customers with insurance claims', 'Insurance Claims')
) AS campaign(name, description, list_name)
CROSS JOIN public.tenants t
LEFT JOIN public.dialer_lists dl ON dl.name = campaign.list_name AND dl.tenant_id = t.id
WHERE t.name = 'O''Brien Contracting'
AND dl.id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM public.dialer_campaigns 
  WHERE name = campaign.name AND tenant_id = t.id
);

-- Insert sample list items (contacts)
INSERT INTO public.dialer_list_items (list_id, first_name, last_name, phone, email, tenant_id, created_by)
SELECT 
  dl.id,
  contact.first_name,
  contact.last_name,
  contact.phone,
  contact.email,
  t.id,
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid
FROM (VALUES 
  ('John', 'Smith', '(555) 123-4567', 'john.smith@email.com', 'Storm Damage Leads'),
  ('Mary', 'Johnson', '(555) 234-5678', 'mary.johnson@email.com', 'Storm Damage Leads'),
  ('Robert', 'Williams', '(555) 345-6789', 'robert.williams@email.com', 'Roof Inspection Follow-ups'),
  ('Linda', 'Brown', '(555) 456-7890', 'linda.brown@email.com', 'Gutter Maintenance'),
  ('David', 'Jones', '(555) 567-8901', 'david.jones@email.com', 'Insurance Claims'),
  ('Susan', 'Miller', '(555) 678-9012', 'susan.miller@email.com', 'New Construction')
) AS contact(first_name, last_name, phone, email, list_name)
CROSS JOIN public.tenants t
LEFT JOIN public.dialer_lists dl ON dl.name = contact.list_name AND dl.tenant_id = t.id
WHERE t.name = 'O''Brien Contracting'
AND dl.id IS NOT NULL;