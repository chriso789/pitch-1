-- Policy: Allow managers to INSERT new stages in their tenant
CREATE POLICY "Managers can create pipeline stages"
ON public.pipeline_stages
FOR INSERT
WITH CHECK (
  tenant_id = get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
);

-- Policy: Allow managers to UPDATE stages in their tenant
CREATE POLICY "Managers can update pipeline stages"
ON public.pipeline_stages
FOR UPDATE
USING (
  tenant_id = get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
)
WITH CHECK (
  tenant_id = get_user_tenant_id()
);

-- Policy: Allow managers to DELETE stages in their tenant
CREATE POLICY "Managers can delete pipeline stages"
ON public.pipeline_stages
FOR DELETE
USING (
  tenant_id = get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
);