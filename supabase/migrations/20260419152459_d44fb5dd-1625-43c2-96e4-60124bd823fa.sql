INSERT INTO demo_requests (first_name, last_name, email, company_name, phone, status, notes, created_at)
SELECT
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'first_name'), ''), 'Unknown'),
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'last_name'), ''), ''),
  u.email,
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'company_name'), ''), 'Unknown (not provided at signup)'),
  NULLIF(TRIM(u.raw_user_meta_data->>'phone'), ''),
  'new',
  'Backfilled from /signup auth user (' ||
    CASE WHEN u.email_confirmed_at IS NULL THEN 'email unconfirmed' ELSE 'email confirmed' END ||
    '). Original signup ' || to_char(u.created_at, 'YYYY-MM-DD') || '.',
  u.created_at
FROM auth.users u
LEFT JOIN demo_requests d ON LOWER(d.email) = LOWER(u.email)
WHERE u.created_at >= NOW() - INTERVAL '6 months'
  AND d.id IS NULL
  AND u.email IS NOT NULL;