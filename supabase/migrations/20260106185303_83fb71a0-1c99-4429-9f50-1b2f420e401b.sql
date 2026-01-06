-- Add DELETE policy for enhanced_estimates so users can delete estimates in their tenant
CREATE POLICY "Users can delete estimates in their tenant"
ON public.enhanced_estimates
FOR DELETE
USING (tenant_id = get_user_tenant_id());