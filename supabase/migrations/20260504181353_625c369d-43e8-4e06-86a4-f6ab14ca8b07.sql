
UPDATE public.tenants SET
  website = 'https://coxroof.com/',
  brand_primary_color = '#CC0000',
  brand_accent_color = '#0D1B2A',
  brand_headline = 'ST. LOUIS|ROOFING|EXPERTS.',
  brand_tagline = 'BBB A+ RATED • THREE GENERATIONS OF ROOFING EXCELLENCE',
  brand_story = 'Cox Roofing & Restoration is a trusted, family-owned roofing company proudly serving the St. Louis community. Three generations of roofing excellence with a BBB A+ rating.',
  brand_stats = '[{"value":"A+","label":"BBB\nRated"},{"value":"3 Gen","label":"Family\nOwned"},{"value":"GAF","label":"Certified\nProducts"},{"value":"Free","label":"Inspections\n& Estimates"}]'::jsonb,
  brand_commitments = '[{"title":"Three Generations of Excellence","body":"Family-owned roofing company with decades of St. Louis expertise passed down through generations.","icon":"award"},{"title":"BBB A+ Rated","body":"Consistently rated A+ by the Better Business Bureau for quality and customer satisfaction.","icon":"shield"},{"title":"GAF Certified","body":"GAF certified products and installation for lasting roof protection.","icon":"wrench"},{"title":"Storm Damage Experts","body":"Free post-storm inspections and insurance claim assistance for fair settlements.","icon":"clock"}]'::jsonb,
  brand_testimonial = '{"quote":"Cox Roofing has protected St. Louis homes for three generations. BBB A+ rated with GAF certified installation you can trust.","attribution":"COX ROOFING PROMISE"}'::jsonb
WHERE id = 'c4d5ef66-ed66-4335-90ed-a96443b7cc43';
