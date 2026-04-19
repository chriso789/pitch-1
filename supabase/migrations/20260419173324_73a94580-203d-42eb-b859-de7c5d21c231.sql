INSERT INTO public.demo_requests (first_name, last_name, email, phone, company_name, message, status, notes, created_at)
VALUES ('Jacob', 'Henderson', 'jacob@supremebuildinggroup.com', NULL, 'Supreme Building Group',
  'Attempted to self-sign up via login page signup tab. Email confirmation failed.',
  'new',
  'Migrated from signup_attempts (source: login_page_signup_tab). Original error: Error sending confirmation email.',
  '2026-04-19 17:17:51.14278+00');