-- Fix RLS policies to use new get_user_tenant_id(uuid) signature
-- This restores visibility of pipeline_entries and projects

-- 1. Add backward-compatible overload first (prevents future breakage)
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_user_tenant_id(auth.uid());
$$;

-- 2. Fix pipeline_entries policies
DROP POLICY IF EXISTS "Users can view pipeline entries in their tenant" ON public.pipeline_entries;
DROP POLICY IF EXISTS "Users can create pipeline entries in their tenant" ON public.pipeline_entries;
DROP POLICY IF EXISTS "Users can update pipeline entries in their tenant" ON public.pipeline_entries;

CREATE POLICY "Users can view pipeline entries in their tenant"
ON public.pipeline_entries
FOR SELECT
TO public
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can create pipeline entries in their tenant"
ON public.pipeline_entries
FOR INSERT
TO public
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update pipeline entries in their tenant"
ON public.pipeline_entries
FOR UPDATE
TO public
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- 3. Fix projects policies
DROP POLICY IF EXISTS "Users can view projects in their tenant" ON public.projects;
DROP POLICY IF EXISTS "Users can create projects in their tenant" ON public.projects;
DROP POLICY IF EXISTS "Users can update projects in their tenant" ON public.projects;

CREATE POLICY "Users can view projects in their tenant"
ON public.projects
FOR SELECT
TO public
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can create projects in their tenant"
ON public.projects
FOR INSERT
TO public
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update projects in their tenant"
ON public.projects
FOR UPDATE
TO public
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- 4. Fix contacts update policy
DROP POLICY IF EXISTS "Users can update contacts in their tenant" ON public.contacts;

CREATE POLICY "Users can update contacts in their tenant"
ON public.contacts
FOR UPDATE
TO public
USING (tenant_id = public.get_user_tenant_id(auth.uid()));