-- Fix company_onboarding_tokens security
-- Remove overly permissive public read policy

DROP POLICY IF EXISTS "Allow public read by token" ON public.company_onboarding_tokens;
DROP POLICY IF EXISTS "Allow authenticated updates" ON public.company_onboarding_tokens;

-- Only allow reading a specific token when the token is provided in the query
-- This prevents enumeration while allowing token validation
CREATE POLICY "Token lookup by exact match only"
ON public.company_onboarding_tokens
FOR SELECT
TO anon
USING (false); -- Anonymous users cannot read tokens at all via API

-- Authenticated admins can manage tokens
CREATE POLICY "Master and corporate can manage tokens"
ON public.company_onboarding_tokens
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('master', 'corporate')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('master', 'corporate')
  )
);

-- Revoke direct access from anon role as additional protection
REVOKE ALL ON public.company_onboarding_tokens FROM anon;