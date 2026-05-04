
-- C-Side Roofing
UPDATE public.tenants SET
  brand_primary_color = '#E63946',
  brand_accent_color = '#1a2332',
  brand_headline = 'LUXURY|COASTAL|ROOFING.',
  brand_tagline = 'PREMIUM TILE • STANDING SEAM METAL • ARCHITECTURAL SHINGLE',
  brand_story = 'We lead with documentation, clean scopes, and coastal-ready installation standards. Built for high-expectation neighborhoods across Miramar Beach, Destin, 30A, Sandestin, and beyond.',
  brand_stats = '[{"value":"CCC1334298","label":"Florida\nCertified"},{"value":"100%","label":"Clean Jobsite\nStandard"},{"value":"3-Tier","label":"Good/Better\n/Best Options"},{"value":"5★","label":"Coastal\nExcellence"}]'::jsonb,
  brand_commitments = '[{"title":"Technology-Forward Verification","body":"Drone + satellite-assisted verification for cleaner scopes, fewer surprises, and faster decisions.","icon":"shield"},{"title":"Clean Jobsites & Premium Execution","body":"Protect landscaping, keep the site clean, and finish with details that hold up on the coast.","icon":"wrench"},{"title":"Coastal-Ready Details","body":"Engineered for wind, salt, and sun — every system is built to last in harsh coastal environments.","icon":"award"},{"title":"No-Pressure Process","body":"Get a fast ballpark first, then book verification to lock your price and timeline.","icon":"clock"}]'::jsonb,
  brand_testimonial = '{"quote":"A premium roof is a decision you should feel confident about. C-Side makes it simple, documented, and dialed in.","attribution":"C-SIDE ROOFING PROMISE"}'::jsonb
WHERE id = '1e3b5562-c89e-489a-a949-ed281d91c889';

-- Expert Building Solutions
UPDATE public.tenants SET
  brand_primary_color = '#E53935',
  brand_accent_color = '#2C2C2C',
  brand_headline = 'DO IT|RIGHT,|DO IT ONCE!',
  brand_tagline = 'SOUTHEAST GEORGIA''S TRUSTED BUILDING SOLUTIONS',
  brand_story = 'Rely on top quality workmanship from a team that will do the job right the first time. We deliver excellence, experience, warranty-backed products, and outstanding commitment to every project.',
  brand_stats = '[{"value":"100%","label":"Quality\nWorkmanship"},{"value":"5★","label":"Customer\nRating"},{"value":"24/7","label":"Service\nAvailable"},{"value":"100%","label":"Licensed\n& Insured"}]'::jsonb,
  brand_commitments = '[{"title":"Excellence","body":"We deliver top quality in every project we undertake.","icon":"award"},{"title":"Experience","body":"Our expertise ensures precise, reliable results every time.","icon":"wrench"},{"title":"Warranty","body":"We guarantee our products and workmanship.","icon":"shield"},{"title":"Commitment","body":"Good price and outstanding service are our promise to you.","icon":"clock"}]'::jsonb,
  brand_testimonial = '{"quote":"ExperTech did the job right the first time — quality workmanship, fair pricing, and true commitment to excellence.","attribution":"VERIFIED CUSTOMER REVIEW"}'::jsonb
WHERE id = '59d81cf7-7236-460e-8819-f7167e5cefc3';

-- Leak Busters Roofing
UPDATE public.tenants SET
  brand_primary_color = '#FFD600',
  brand_accent_color = '#0D1B2A',
  brand_headline = 'SAME-DAY|ROOFING|SERVICES.',
  brand_tagline = 'LICENSED AND INSURED ROOFING CONTRACTORS SERVING FLORIDA',
  brand_story = 'Leak Busters Roof Repair provides same-day roofing services across Fort Pierce, Port St. Lucie, Port Charlotte, Fort Myers, and Sarasota. Licensed and insured since 2016.',
  brand_stats = '[{"value":"4.8★","label":"Google\nRating"},{"value":"115+","label":"Customer\nReviews"},{"value":"Since 2016","label":"Serving\nFlorida"},{"value":"24/7","label":"Emergency\nAvailable"}]'::jsonb,
  brand_commitments = '[{"title":"Fast Response","body":"Same-day emergency service and 24/7 availability for storm damage and urgent roof repairs.","icon":"clock"},{"title":"Highly Rated","body":"4.8-star Google rating with 115+ reviews. Top rated on HomeAdvisor and Facebook.","icon":"award"},{"title":"Free Inspections","body":"Licensed inspector evaluates your roof''s condition and identifies damage before costly repairs.","icon":"shield"},{"title":"Expert Installations","body":"All work uses high-quality materials performed by a licensed and insured team.","icon":"wrench"}]'::jsonb,
  brand_testimonial = '{"quote":"Leak Busters responded the same day, fixed our roof leak fast, and the quality was outstanding. Highly recommend!","attribution":"VERIFIED GOOGLE REVIEW"}'::jsonb
WHERE id = 'a05d8b9c-06da-47bb-a15a-c48fe712a8f0';

-- Legacy Exteriors
UPDATE public.tenants SET
  brand_primary_color = '#D4A843',
  brand_accent_color = '#1a1a1a',
  brand_headline = 'EXPERT|BUILDING|SOLUTIONS.',
  brand_tagline = 'QUALITY CONSTRUCTION SERVICES FOR EVERY PROJECT NEED',
  brand_story = 'Legacy Exteriors provides expert building solutions for your home. Quality construction services for every project need — from roofing to solar to full exterior renovations.',
  brand_stats = '[{"value":"100%","label":"Quality\nGuaranteed"},{"value":"5★","label":"Customer\nSatisfaction"},{"value":"Full","label":"Licensed\n& Insured"},{"value":"Free","label":"Estimates\nAlways"}]'::jsonb,
  brand_commitments = '[{"title":"Quality Craftsmanship","body":"Expert building solutions with attention to detail and premium materials.","icon":"award"},{"title":"Full-Service Contractor","body":"Roofing, solar, windows, and complete exterior renovations under one roof.","icon":"wrench"},{"title":"Licensed & Insured","body":"Fully licensed and insured for your peace of mind on every project.","icon":"shield"},{"title":"Free Estimates","body":"No-obligation estimates with honest, transparent pricing.","icon":"clock"}]'::jsonb,
  brand_testimonial = '{"quote":"Legacy Exteriors delivered expert building solutions with quality craftsmanship and outstanding customer service.","attribution":"VERIFIED HOMEOWNER"}'::jsonb
WHERE id = '5d250471-1452-4bf1-8f6c-daa6243b3249';

-- O'Brien Contracting
UPDATE public.tenants SET
  brand_primary_color = '#3B6B3B',
  brand_accent_color = '#1a2e1a',
  brand_headline = 'SOUTH FLORIDA''S|TRUSTED|ROOFING SPECIALIST.',
  brand_tagline = 'LICENSED CCC1335947 • SERVING FLORIDA & GEORGIA',
  brand_story = 'From Miami to Naples, we''ve been protecting Florida homes with quality roofing for over 10 years. Metal roofing, tile, shingles, and more. Qualified contractor for My Safe Florida Home grants.',
  brand_stats = '[{"value":"4.9★","label":"Google\nRating"},{"value":"50+","label":"Customer\nReviews"},{"value":"10+","label":"Years\nExperience"},{"value":"24/7","label":"Emergency\nAvailable"}]'::jsonb,
  brand_commitments = '[{"title":"Complete Roofing Solutions","body":"From repairs to full replacements — metal, tile, shingle, and flat roof systems.","icon":"wrench"},{"title":"Licensed & Insured","body":"Florida Certified Roofing Contractor CCC1335947 with full insurance coverage.","icon":"shield"},{"title":"Grant Qualified","body":"Approved contractor for the My Safe Florida Home program — up to $10,000 for your roof.","icon":"award"},{"title":"Emergency Service","body":"24/7 emergency response for storm damage and urgent roofing needs.","icon":"clock"}]'::jsonb,
  brand_testimonial = '{"quote":"O''Brien Contracting delivered exceptional quality roofing work. Professional, on time, and the finished product is outstanding.","attribution":"VERIFIED GOOGLE REVIEW"}'::jsonb
WHERE id = '14de934e-7964-4afd-940a-620d2ace125d';

-- Solution Roofing LLC
UPDATE public.tenants SET
  brand_primary_color = '#E53935',
  brand_accent_color = '#2C2C2C',
  brand_headline = 'EXCEPTIONAL|QUALITY.|SUPERIOR SOLUTIONS.',
  brand_tagline = 'JERSEYVILLE & ALTON IL ROOFING CONTRACTOR YOU CAN TRUST',
  brand_story = 'Solution Roofing LLC delivers expert roof repair, roof replacement, and storm damage roofing across Jerseyville, Alton, Wood River, Godfrey, Bethalto, and surrounding Riverbend Area communities.',
  brand_stats = '[{"value":"24/7","label":"Service\nAvailable"},{"value":"100%","label":"Licensed\n& Insured"},{"value":"5★","label":"Customer\nRating"},{"value":"Free","label":"Inspections\nAlways"}]'::jsonb,
  brand_commitments = '[{"title":"Storm Damage Experts","body":"Specializing in hail damage repair, insurance claim roofing, and emergency response.","icon":"shield"},{"title":"Quality Craftsmanship","body":"Fast inspections, honest pricing, and quality work designed for long-term protection.","icon":"wrench"},{"title":"Local & Trusted","body":"Serving Riverbend Area communities with a focus on durability, safety, and results.","icon":"award"},{"title":"Insurance Claim Support","body":"We guide you through the insurance process for hassle-free storm damage repairs.","icon":"clock"}]'::jsonb,
  brand_testimonial = '{"quote":"Solution Roofing delivered exceptional quality and superior service. Honest pricing, fast inspection, and outstanding craftsmanship.","attribution":"VERIFIED HOMEOWNER REVIEW"}'::jsonb
WHERE id = '30f71f27-8a91-404f-b835-13f436faaf55';

-- The Roof Panda
UPDATE public.tenants SET
  brand_primary_color = '#E31E24',
  brand_accent_color = '#1a1a1a',
  brand_headline = 'TAMPA''S|BEST|ROOFING SOLUTION.',
  brand_tagline = 'WE WILL BEAT ANY QUOTE! • 24/7 SERVICE',
  established_year = 2004,
  brand_story = 'Roof Panda is your trusted partner for all roofing needs in Tampa, FL, and surrounding areas including Hillsborough and Pinellas County. Over 20 years of experience in the roofing industry.',
  brand_stats = '[{"value":"20+","label":"Years\nExperience"},{"value":"5★","label":"Customer\nRating"},{"value":"24/7","label":"Service\nAvailable"},{"value":"Free","label":"Estimates\nAlways"}]'::jsonb,
  brand_commitments = '[{"title":"Beat Any Quote","body":"We will beat any competitor''s quote — guaranteed best pricing on every project.","icon":"award"},{"title":"24/7 Emergency Service","body":"Round-the-clock availability for urgent roof repairs and storm damage response.","icon":"clock"},{"title":"All Roof Types","body":"Shingle, tile, metal, and flat roofs — residential and commercial expert installation.","icon":"wrench"},{"title":"Licensed & Insured","body":"Fully licensed and insured for your complete peace of mind.","icon":"shield"}]'::jsonb,
  brand_testimonial = '{"quote":"Roof Panda beat every quote we got, showed up on time, and delivered an incredible roof. Can''t recommend them enough!","attribution":"VERIFIED TAMPA HOMEOWNER"}'::jsonb
WHERE id = '6e7d133d-39b7-440a-bca1-c7ed31d3c7eb';

-- Titan Roof Coatings (Roof King)
UPDATE public.tenants SET
  brand_primary_color = '#1B3A6B',
  brand_accent_color = '#0D1B2A',
  brand_headline = 'ROOFING THAT|STANDS UP|TO MOTHER NATURE.',
  brand_tagline = 'SPF ROOFING SPECIALISTS • SERVING FLORIDA & US',
  brand_story = 'Welcome to Roof King, where SPF roofing isn''t just a service — it''s an art form. Our dedication to the craft of roofing goes beyond the ordinary with years of expertise and a passion for precision.',
  brand_stats = '[{"value":"100%","label":"Guaranteed\nSystems"},{"value":"FL & US","label":"Service\nArea"},{"value":"SPF","label":"Roofing\nSpecialists"},{"value":"5★","label":"Quality\nCraftsmanship"}]'::jsonb,
  brand_commitments = '[{"title":"SPF Roofing Expertise","body":"Specialized spray polyurethane foam roofing systems built to withstand any weather.","icon":"shield"},{"title":"Guaranteed Systems","body":"Every roofing system is guaranteed to stand up to Mother Nature — period.","icon":"award"},{"title":"Maintenance & Repair","body":"Complete maintenance, roofing, and repair services for lasting protection.","icon":"wrench"},{"title":"Nationwide Service","body":"Serving the entire state of Florida and beyond with premium roofing solutions.","icon":"clock"}]'::jsonb,
  brand_testimonial = '{"quote":"Roof King''s SPF system transformed our building. It stands up to Florida storms like nothing else we''ve tried.","attribution":"VERIFIED COMMERCIAL CLIENT"}'::jsonb
WHERE id = '71fc0c5c-e8f6-48ca-aeed-05ba8239bf06';

-- Tristate Contracting Group
UPDATE public.tenants SET
  brand_primary_color = '#4AA89A',
  brand_accent_color = '#1a2e2a',
  brand_headline = 'TRUSTED|CRAFTSMANSHIP|SINCE DAY ONE.',
  brand_tagline = '5-STAR RATED • FULLY INSURED & LICENSED • WARRANTY-BACKED',
  brand_story = 'Tri-State Contracting Group delivers high-quality roofing, remodeling, and construction services with a commitment to craftsmanship, communication, and long-term durability.',
  brand_stats = '[{"value":"5★","label":"Rated\nContractor"},{"value":"100%","label":"Fully\nInsured"},{"value":"Warranty","label":"Backed\nWork"},{"value":"Local","label":"Family\nOperated"}]'::jsonb,
  brand_commitments = '[{"title":"Roofing Solutions","body":"From repairs to full replacements — built to withstand time, weather, and Pennsylvania''s changing seasons.","icon":"wrench"},{"title":"Solar Installation","body":"Smart energy solutions installed with precision and clean integration with your home.","icon":"award"},{"title":"Insurance Claim Assistance","body":"We guide homeowners through the insurance process to ensure repairs are done correctly.","icon":"shield"},{"title":"Clear Communication","body":"Transparent updates, honest pricing, and a commitment to keeping you informed every step.","icon":"clock"}]'::jsonb,
  brand_testimonial = '{"quote":"Tri-State delivered outstanding craftsmanship on our roof replacement. Clear communication from start to finish.","attribution":"VERIFIED TRI-STATE HOMEOWNER"}'::jsonb
WHERE id = '76ee42a0-6e96-4161-a7a6-abbdd3a6017d';

-- Under One Roof
UPDATE public.tenants SET
  brand_primary_color = '#7B2D8E',
  brand_accent_color = '#1a1a2e',
  brand_headline = 'LOCAL|ROOFING|EXPERTS.',
  brand_tagline = '30+ YEARS EXPERIENCE • 5-STAR REVIEWS • LOCALLY OWNED',
  brand_story = 'Based in Farmers Branch, we handle homes, apartments, townhomes, and commercial buildings across the Dallas-Fort Worth metroplex. Over 30 years of trusted roofing experience.',
  brand_stats = '[{"value":"30+","label":"Years\nExperience"},{"value":"5★","label":"Customer\nReviews"},{"value":"100+","label":"Five-Star\nRatings"},{"value":"Local","label":"Owned &\nOperated"}]'::jsonb,
  brand_commitments = '[{"title":"Storm Damage Experts","body":"Hail, wind, and storm damage repair with full insurance claim assistance.","icon":"shield"},{"title":"All Property Types","body":"Homes, apartments, townhomes, and commercial buildings across Dallas-Fort Worth.","icon":"wrench"},{"title":"100+ Five-Star Reviews","body":"Trusted by the community with over 100 verified five-star ratings.","icon":"award"},{"title":"Emergency Services","body":"Emergency roofing services available when you need us most.","icon":"clock"}]'::jsonb,
  brand_testimonial = '{"quote":"Under One Roof has been protecting DFW properties for 30+ years. Local, trusted, and they never disappear after the deposit.","attribution":"VERIFIED DFW HOMEOWNER"}'::jsonb
WHERE id = '5a02983a-3d4d-4d5e-af01-7f2c7f02e78c';
