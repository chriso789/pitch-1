-- Seed default lead sources for tracking
INSERT INTO public.lead_sources (tenant_id, name, category, description, is_active)
SELECT 
  t.id as tenant_id,
  source.name,
  source.category,
  source.description,
  true as is_active
FROM public.tenants t
CROSS JOIN (
  VALUES 
    ('Door Knock', 'direct', 'In-person canvassing'),
    ('Referral', 'referral', 'Customer or partner referral'),
    ('Google', 'online', 'Google search or ads'),
    ('Facebook', 'social', 'Facebook advertising'),
    ('Instagram', 'social', 'Instagram advertising'),
    ('Yard Sign', 'advertising', 'Physical yard signage'),
    ('Call In', 'direct', 'Inbound phone inquiry'),
    ('Vehicle', 'advertising', 'Vehicle wrap/signage')
) AS source(name, category, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_sources ls 
  WHERE ls.tenant_id = t.id AND ls.name = source.name
);