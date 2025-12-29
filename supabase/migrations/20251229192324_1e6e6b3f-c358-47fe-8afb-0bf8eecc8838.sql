-- Copy standard templates to tenant 14de934e-7964-4afd-940a-620d2ace125d with roof_type
INSERT INTO public.estimate_templates (id, tenant_id, name, template_data, is_active, roof_type, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  '14de934e-7964-4afd-940a-620d2ace125d',
  name,
  template_data,
  is_active,
  COALESCE(roof_type, 'shingle'),
  NOW(),
  NOW()
FROM public.estimate_templates
WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000'
ON CONFLICT DO NOTHING;