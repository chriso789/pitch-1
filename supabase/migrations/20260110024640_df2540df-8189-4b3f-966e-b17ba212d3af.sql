-- Fix RLS on company_api_keys to use user_company_access instead of profiles.tenant_id
-- This allows users to manage API keys for any company they have full access to

-- Drop existing broken policy
DROP POLICY IF EXISTS "Admins can manage API keys for their tenant" ON public.company_api_keys;

-- Create SELECT policy - users can view API keys for companies they have access to
CREATE POLICY "Users can view API keys for accessible companies"
ON public.company_api_keys
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid()
    AND uca.tenant_id = company_api_keys.tenant_id
    AND uca.is_active = true
  )
);

-- Create INSERT policy - users with full access can create API keys
CREATE POLICY "Users with full access can create API keys"
ON public.company_api_keys
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid()
    AND uca.tenant_id = company_api_keys.tenant_id
    AND uca.is_active = true
    AND uca.access_level = 'full'
  )
);

-- Create UPDATE policy - users with full access can update API keys
CREATE POLICY "Users with full access can update API keys"
ON public.company_api_keys
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid()
    AND uca.tenant_id = company_api_keys.tenant_id
    AND uca.is_active = true
    AND uca.access_level = 'full'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid()
    AND uca.tenant_id = company_api_keys.tenant_id
    AND uca.is_active = true
    AND uca.access_level = 'full'
  )
);

-- Create DELETE policy - users with full access can delete API keys
CREATE POLICY "Users with full access can delete API keys"
ON public.company_api_keys
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid()
    AND uca.tenant_id = company_api_keys.tenant_id
    AND uca.is_active = true
    AND uca.access_level = 'full'
  )
);

-- Fix RLS on external_lead_submissions to use user_company_access
-- Drop existing policy that only checks profiles.tenant_id
DROP POLICY IF EXISTS "Users can view submissions for their tenant" ON public.external_lead_submissions;

-- Create new SELECT policy based on user_company_access membership
CREATE POLICY "Users can view submissions for accessible companies"
ON public.external_lead_submissions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid()
    AND uca.tenant_id = external_lead_submissions.tenant_id
    AND uca.is_active = true
  )
);