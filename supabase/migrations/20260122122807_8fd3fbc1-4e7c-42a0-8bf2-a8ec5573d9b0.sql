-- Fix RLS policies for internal_notes to use user_company_access table
-- This allows users to add notes to any tenant they have access to

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view notes in their tenant" ON public.internal_notes;
DROP POLICY IF EXISTS "Users can create notes in their tenant" ON public.internal_notes;
DROP POLICY IF EXISTS "Authors can update their notes" ON public.internal_notes;
DROP POLICY IF EXISTS "Authors and admins can delete notes" ON public.internal_notes;

-- Create new policies using user_company_access table
CREATE POLICY "Users can view notes in their tenant"
  ON public.internal_notes FOR SELECT
  USING (
    tenant_id IN (
      SELECT uca.tenant_id FROM public.user_company_access uca 
      WHERE uca.user_id = auth.uid() AND uca.is_active = true
    )
    OR tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    OR tenant_id = (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can create notes in their tenant"
  ON public.internal_notes FOR INSERT
  WITH CHECK (
    author_id = auth.uid() AND
    (
      tenant_id IN (
        SELECT uca.tenant_id FROM public.user_company_access uca 
        WHERE uca.user_id = auth.uid() AND uca.is_active = true
      )
      OR tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
      OR tenant_id = (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Authors can update their notes"
  ON public.internal_notes FOR UPDATE
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Authors and admins can delete notes"
  ON public.internal_notes FOR DELETE
  USING (
    author_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid() 
      AND uca.tenant_id = internal_notes.tenant_id 
      AND uca.is_active = true
      AND uca.access_level = 'full'
    )
  );