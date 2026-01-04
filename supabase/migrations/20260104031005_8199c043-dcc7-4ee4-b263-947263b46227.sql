-- Drop the duplicate/conflicting SELECT policy on profiles
-- The profiles_select_with_hidden policy already handles all cases
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;

-- Bootstrap master user's metadata so can_view_hidden_users() works
UPDATE auth.users 
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"role": "master"}'::jsonb
WHERE email = 'chrisobrien91@gmail.com';