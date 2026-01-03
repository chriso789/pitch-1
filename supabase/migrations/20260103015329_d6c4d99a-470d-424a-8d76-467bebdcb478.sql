-- Add INSERT, UPDATE, DELETE policies for commission_plans table
-- This fixes the RLS error when saving commission plans

-- Allow users to INSERT commission plans in their tenant
CREATE POLICY "Users can create commission plans in their tenant"
ON commission_plans
FOR INSERT
WITH CHECK (tenant_id = get_user_tenant_id());

-- Allow users to UPDATE commission plans in their tenant
CREATE POLICY "Users can update commission plans in their tenant"
ON commission_plans
FOR UPDATE
USING (tenant_id = get_user_tenant_id());

-- Allow users to DELETE their own commission plans
CREATE POLICY "Users can delete commission plans in their tenant"
ON commission_plans
FOR DELETE
USING (tenant_id = get_user_tenant_id());