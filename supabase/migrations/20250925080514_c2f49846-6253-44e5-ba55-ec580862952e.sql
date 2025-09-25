-- Create profile for the authenticated user if it doesn't exist
-- First, let's check if we need to create a profiles table trigger

-- Create a function to handle new user signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    first_name, 
    last_name, 
    email,
    tenant_id,
    role
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'first_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'last_name', ''),
    NEW.email,
    -- For now, assign to the same tenant as Christopher O'Brien
    '14de934e-7964-4afd-940a-620d2ace125d'::uuid,
    'admin'::app_role
  ) ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = now();
  
  RETURN NEW;
END;
$$;

-- Drop the trigger if it exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger for new user signups
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Manually create profile for existing user if needed
INSERT INTO public.profiles (
  id, 
  first_name, 
  last_name, 
  email,
  tenant_id,
  role,
  created_at,
  updated_at
) 
SELECT 
  au.id,
  COALESCE(au.raw_user_meta_data ->> 'first_name', 'Christopher'),
  COALESCE(au.raw_user_meta_data ->> 'last_name', 'O''Brien'),
  au.email,
  '14de934e-7964-4afd-940a-620d2ace125d'::uuid,
  'admin'::app_role,
  now(),
  now()
FROM auth.users au
WHERE au.email = 'chrisobrien91@gmail.com'
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  tenant_id = EXCLUDED.tenant_id,
  role = EXCLUDED.role,
  updated_at = now();