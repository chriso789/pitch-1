
-- Populate real brand data from company websites for non-O'Brien tenants

-- C-Side Roofing
UPDATE public.tenants SET
  brand_story = 'Luxury coastal roofing—made simple, documented, and dialed in. Built for high-expectation neighborhoods across Miramar Beach, Destin, 30A, Sandestin, and beyond.',
  brand_mission = 'Premium roof systems with technology-forward verification, drone and satellite-assisted scoping, and coastal-ready installation standards.',
  brand_certifications = 'Florida Certified Roofing Contractor; GAF Certified; Premium Tile Specialist; Standing Seam Metal Certified',
  license_number = 'CCC1334298',
  established_year = 2018,
  phone = '850-749-5447',
  primary_color = '#1B2A4A',
  secondary_color = '#C9A96E'
WHERE id = '1e3b5562-c89e-489a-a949-ed281d91c889';

-- Leak Busters Roofing
UPDATE public.tenants SET
  brand_story = 'Leak Busters Roof Repair provides same-day roofing services across Florida''s Treasure Coast and Gulf Coast. Licensed and insured since 2016 with a 4.8-star Google rating.',
  brand_mission = 'Same-day response, free inspections, and transparent pricing for every residential and commercial roofing project.',
  brand_certifications = 'Licensed & Insured Florida Contractor; HomeAdvisor 4.9/5.0; 5-Star Yelp Rating; BBB Accredited',
  established_year = 2016,
  phone = '772-332-8450',
  primary_color = '#1E3A5F',
  secondary_color = '#E8B931'
WHERE id = 'a05d8b9c-06da-47bb-a15a-c48fe712a8f0';

-- The Roof Panda
UPDATE public.tenants SET
  brand_story = 'Roof Panda is Tampa''s trusted partner for all roofing needs — over 20 years of experience in Hillsborough and Pinellas County. We specialize in shingle, tile, metal, and flat roofs for residential and commercial properties.',
  brand_mission = 'Reliable, professional, and cost-effective roof installation and repair tailored to each client''s unique requirements.',
  brand_certifications = 'Licensed & Insured Florida Contractor; 20+ Years Experience; Shingle, Tile, Metal & Flat Roof Specialist',
  established_year = 2004,
  phone = '813-295-7663',
  primary_color = '#2D5016',
  secondary_color = '#F5A623'
WHERE id = '6e7d133d-39b7-440a-bca1-c7ed31d3c7eb';

-- Tristate Contracting Group
UPDATE public.tenants SET
  brand_story = 'Tri-State Contracting Group delivers high-quality roofing, remodeling, and construction services with a commitment to craftsmanship, communication, and long-term durability across the Tri-State Area.',
  brand_mission = 'Trusted craftsmanship since day one. Local, family-operated, and warranty-backed work for every project.',
  brand_certifications = '5-Star Rated Contractor; Fully Insured & Licensed; Warranty-Backed Work; Local & Family-Operated',
  phone = '215-240-0685',
  primary_color = '#1A365D',
  secondary_color = '#DD6B20'
WHERE id = '76ee42a0-6e96-4161-a7a6-abbdd3a6017d';

-- Under One Roof
UPDATE public.tenants SET
  brand_story = 'Under One Roof is a family-operated roofing contractor with 30+ years of experience serving Dallas-Fort Worth. We handle homes, apartments, townhomes, and commercial buildings across DFW.',
  brand_mission = 'Honest evaluations, quality workmanship, and local expertise for every roofing project in the DFW metroplex.',
  brand_certifications = 'Metrocrest Chamber Member; 30+ Years Experience; 5-Star Reviews; Licensed & Insured Texas Contractor',
  established_year = 1994,
  phone = '214-649-5984',
  primary_color = '#8B4513',
  secondary_color = '#DAA520'
WHERE id = '5a02983a-3d4d-4d5e-af01-7f2c7f02e78c';

-- Solution Roofing LLC
UPDATE public.tenants SET
  brand_story = 'Solution Roofing LLC delivers expert roof repair, replacement, and storm damage restoration across Jerseyville, Alton, and the Riverbend Area communities of Illinois.',
  brand_mission = 'Exceptional Quality. Superior Solutions. Fast inspections, honest pricing, and quality craftsmanship for every project.',
  brand_certifications = 'Licensed & Insured Illinois Contractor; Storm Damage & Insurance Claim Specialist; Hail Damage Repair Expert',
  phone = '618-307-5174',
  primary_color = '#CC0000',
  secondary_color = '#333333'
WHERE id = '30f71f27-8a91-404f-b835-13f436faaf55';

-- Expert Building Solutions
UPDATE public.tenants SET
  brand_story = 'ExperTech serves Southeast Georgia with top-quality gutter installation, cleaning, and repair. Do It Right, Do It Once — that''s our promise.',
  brand_mission = 'Excellence in workmanship, professionalism in service, and guaranteed satisfaction on every gutter and exterior project.',
  brand_certifications = 'Licensed Georgia Contractor; Gutter Installation Specialist; Southeast Georgia Service Area',
  phone = '912-378-3828',
  primary_color = '#1B4332',
  secondary_color = '#40916C'
WHERE id = '59d81cf7-7236-460e-8819-f7167e5cefc3';

-- Titan Roof Coatings (Roof King)
UPDATE public.tenants SET
  brand_story = 'Roof King specializes in SPF roofing systems guaranteed to stand up to Mother Nature. Our dedication to the craft of roofing goes beyond the ordinary — serving Florida and nationwide.',
  brand_mission = 'Finally, a roofing system that''s guaranteed to stand up to Mother Nature. Expert SPF roofing maintenance, repair, and installation.',
  brand_certifications = 'SPF Roofing Specialist; Serving State of Florida & US; Licensed & Insured',
  phone = '954-782-3002',
  primary_color = '#0D1B2A',
  secondary_color = '#1B998B'
WHERE id = '71fc0c5c-e8f6-48ca-aeed-05ba8239bf06';

-- Legacy Exteriors
UPDATE public.tenants SET
  brand_story = 'Legacy Exteriors provides expert building solutions for homes across Texas — quality construction services for every project need.',
  brand_mission = 'Expert building solutions for your home with quality construction services you can trust.',
  brand_certifications = 'Licensed Texas Contractor; Residential Construction Specialist',
  phone = '512-889-5335',
  primary_color = '#2C3E50',
  secondary_color = '#E67E22'
WHERE id = '5d250471-1452-4bf1-8f6c-daa6243b3249';
