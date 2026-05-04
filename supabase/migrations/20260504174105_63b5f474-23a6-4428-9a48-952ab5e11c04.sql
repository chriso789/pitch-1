UPDATE tenants SET
  established_year = 2014,
  brand_story = 'Your home is your biggest investment — we treat it like our own. A local, family-run business serving Florida since 2014 with expert crews and premium products delivering outstanding results.',
  brand_mission = 'Go Green and Save Green — energy efficient products, reduced overhead, and bottom line pricing without compromising on quality or service.',
  brand_certifications = 'BBB A+ Accredited Business · Angie''s List Super Service · HomeAdvisor Top Rated · Google 4.5★ (98 Reviews)',
  brand_tagline = 'FLORIDA''S #1 ALL IN ONE CONTRACTOR',
  brand_headline = 'GO|GREEN.|SAVE GREEN.',
  brand_stats = '[
    {"value": "40+", "label": "Years of\nExperience"},
    {"value": "1,250+", "label": "Home\nProjects"},
    {"value": "4.5★", "label": "Google\nRating"},
    {"value": "A+", "label": "BBB\nAccredited"}
  ]'::jsonb,
  brand_testimonial = '{"quote": "Your home is your biggest investment — Green Home Improvements treats it like their own. No haggling, no games, zero pressure.", "attribution": "VERIFIED HOMEOWNER REVIEW"}'::jsonb,
  brand_commitments = '[
    {"title": "No Pressure Quotes", "body": "Get a free, honest estimate with zero obligation or pushy sales tactics.", "icon": "shield"},
    {"title": "High End Products", "body": "We use only premium, industry-leading materials built to last.", "icon": "award"},
    {"title": "Top Notch Installs", "body": "Expert crews deliver precision installations on every project.", "icon": "wrench"},
    {"title": "5 Star Customer Care", "body": "Dedicated support from start to finish and beyond.", "icon": "clock"}
  ]'::jsonb,
  brand_primary_color = '#1B8C3A',
  brand_accent_color = '#1a3a1a'
WHERE id = 'fa1c524e-5267-4764-b662-22afdec61d88';