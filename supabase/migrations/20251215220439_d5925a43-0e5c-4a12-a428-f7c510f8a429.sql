-- Remove overly permissive policy that allows public read access
DROP POLICY IF EXISTS "Service role can manage all sessions" ON public.marketing_sessions;

-- The existing policies are correct:
-- "Admins can view sessions in their tenant" for SELECT (authenticated admins only)
-- "Public can insert marketing sessions" for INSERT (marketing tracking only)