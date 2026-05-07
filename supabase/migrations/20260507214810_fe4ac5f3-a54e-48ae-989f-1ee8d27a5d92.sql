update public.tenants
set
  brand_commitments = '[
    {"title":"Roofing Solutions","body":"From repairs to full replacements — built to withstand time, weather, and Pennsylvania''s changing seasons.","icon":"wrench"},
    {"title":"Remodeling & Renovations","body":"Interior and exterior improvements completed with careful planning, skilled execution, and clean finish details.","icon":"award"},
    {"title":"Insurance Claim Assistance","body":"We guide homeowners through the insurance process to ensure repairs are done correctly.","icon":"shield"},
    {"title":"Clear Communication","body":"Transparent updates, honest pricing, and a commitment to keeping you informed every step.","icon":"clock"}
  ]'::jsonb,
  settings = jsonb_set(
    coalesce(settings, '{}'::jsonb),
    '{brand_commitments}',
    '[
      {"title":"Roofing Solutions","body":"From repairs to full replacements — built to withstand time, weather, and Pennsylvania''s changing seasons.","icon":"wrench"},
      {"title":"Remodeling & Renovations","body":"Interior and exterior improvements completed with careful planning, skilled execution, and clean finish details.","icon":"award"},
      {"title":"Insurance Claim Assistance","body":"We guide homeowners through the insurance process to ensure repairs are done correctly.","icon":"shield"},
      {"title":"Clear Communication","body":"Transparent updates, honest pricing, and a commitment to keeping you informed every step.","icon":"clock"}
    ]'::jsonb,
    true
  ),
  established_year = 2003
where id = '76ee42a0-6e96-4161-a7a6-abbdd3a6017d'
  and name ilike '%tristate%';