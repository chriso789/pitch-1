
UPDATE tenants
SET settings = COALESCE(settings, '{}'::jsonb) 
  || jsonb_build_object(
    'about_us', 'Tri-State Contracting Group is a general contractor based in Ridley Park, PA, servicing the Pennsylvania, New Jersey, and Delaware tri-state area since 2003. Specializing in roofing, solar installation, remodeling, renovations, and insurance claim assistance, they deliver high-quality construction services with a commitment to craftsmanship, communication, and long-term durability. Fully insured, licensed, and warranty-backed — a 5-star rated, local, family-operated business.',
    'brand_story', 'Tri-State Contracting Group was founded on a simple principle: do the work right, stand behind it, and treat every client with respect. For over 20 years, we have earned our reputation through consistent results, honest communication, and attention to detail that many contractors overlook. We don''t cut corners. We don''t disappear after the job is done. And we don''t compromise on quality.',
    'brand_mission', 'To deliver dependable construction solutions that protect, improve, and add long-term value to every property we touch.',
    'brand_tagline', 'Trusted Craftsmanship Since 2003',
    'brand_headline', 'Trusted Construction & Roofing Experts Serving the Tri-State Area',
    'brand_certifications', 'Fully Insured & Licensed, Warranty-Backed Work, Residential & Commercial Roofing, Solar Installation, Remodeling & Renovations, Insurance Claim Assistance, Gutters, Siding',
    'brand_stats', '[{"value":"5★","label":"Rated Contractor"},{"value":"2003","label":"Established"},{"value":"3","label":"States Served"},{"value":"24hr","label":"Response Time"}]'::jsonb,
    'brand_testimonial', '{"quote":"Chris and his crew leader Pat were super responsive to our questions and concerns in redoing an old kitchen. They came out and over delivered on every promise that was made. I would recommend them for my next upgrade/new build projects 1000%.","attribution":"Rick Ulsh"}'::jsonb,
    'brand_commitments', '[{"title":"Craftsmanship Without Shortcuts","body":"Every project is approached with careful planning, skilled execution, and clear communication."},{"title":"Transparent Communication","body":"We believe homeowners deserve clear answers, reliable timelines, and work that stands the test of time."},{"title":"Warranty-Backed Accountability","body":"We stand behind every job. If something isn''t right, we address it immediately and honor our warranty."},{"title":"Long-Term Relationships","body":"Our clients choose us because they want the job done right — the first time. We prioritize relationships over short-term wins."}]'::jsonb
  )
WHERE id = '76ee42a0-6e96-4161-a7a6-abbdd3a6017d';
