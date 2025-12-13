-- Fix the trigger to run AFTER INSERT instead of BEFORE INSERT
-- This prevents the FK violation when inserting into user_company_access

DROP TRIGGER IF EXISTS ensure_user_company_access_trigger ON profiles;

-- Recreate as AFTER INSERT trigger (profile row exists when this runs)
CREATE TRIGGER ensure_user_company_access_trigger 
AFTER INSERT OR UPDATE ON public.profiles 
FOR EACH ROW EXECUTE FUNCTION ensure_user_company_access();