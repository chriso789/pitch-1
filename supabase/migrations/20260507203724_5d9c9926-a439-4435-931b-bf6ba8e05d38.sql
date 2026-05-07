
-- Remove "solar installation" from about_us and settings for Tristate Contracting
UPDATE tenants
SET 
  about_us = 'Tri-State Contracting Group is a general contractor from the Philadelphia tristate area, servicing PA, NJ, and DE since 2003. They specialize in roofing, remodeling, renovations, and insurance claim assistance. They are a local, family-operated, fully insured and licensed 5-star rated contractor with warranty-backed work. Founded on integrity and proven through results.',
  established_year = 2003,
  settings = jsonb_set(
    jsonb_set(
      settings,
      '{brand_certifications}',
      '"Fully Insured & Licensed, Warranty-Backed Work, Residential & Commercial Roofing, Remodeling & Renovations, Insurance Claim Assistance, Gutters, Siding"'
    ),
    '{founded_year}',
    '2003'
  )
WHERE id = '76ee42a0-6e96-4161-a7a6-abbdd3a6017d';
