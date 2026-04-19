INSERT INTO public.demo_requests (first_name, last_name, email, phone, company_name, status, notes, created_at)
SELECT * FROM (VALUES
  ('Aj', 'Grosbeck', 'addison12307@gmail.com', NULL::text, 'Roof Kings Coatings', 'new', 'Backfilled from /signup auth user (email confirmed, no tenant provisioned). Original signup 2026-03-14.', '2026-03-14 17:41:37+00'::timestamptz)
) AS v(first_name, last_name, email, phone, company_name, status, notes, created_at)
WHERE NOT EXISTS (SELECT 1 FROM public.demo_requests dr WHERE lower(dr.email) = lower(v.email));