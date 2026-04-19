INSERT INTO public.demo_requests (first_name, last_name, email, phone, company_name, status, notes, created_at)
SELECT * FROM (VALUES
  ('Jay', 'Luna', 'jayalldayroofing@gmail.com', NULL::text, 'Jay All Day Roofing', 'new', 'Backfilled from /signup auth user (email unconfirmed). Original signup 2026-04-17.', '2026-04-17 19:46:08+00'::timestamptz),
  ('Drew', 'Braddock', 'info@laderaroofing.com', NULL, 'Ladera Roofing', 'new', 'Backfilled from /signup auth user (email unconfirmed). Original signup 2026-04-13.', '2026-04-13 02:05:44+00'::timestamptz),
  ('Gavin', 'Harrington', 'gavin@expertechga.com', NULL, 'Expert Building Solutions', 'new', 'Backfilled from /signup auth user (email confirmed, no tenant). Original signup 2026-04-13.', '2026-04-13 02:15:52+00'::timestamptz)
) AS v(first_name, last_name, email, phone, company_name, status, notes, created_at)
WHERE NOT EXISTS (SELECT 1 FROM public.demo_requests dr WHERE dr.email = v.email);