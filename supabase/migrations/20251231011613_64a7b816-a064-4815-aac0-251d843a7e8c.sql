-- First recreate the dropped policy temporarily to not break things
-- Then replace with proper secure policies

-- Policy: Users can only view their own rewards, high-level roles can view all in tenant
CREATE POLICY "Users can view own or admin view all rewards"
ON public.achievement_rewards
FOR SELECT
TO authenticated
USING (
  tenant_id = get_user_tenant_id() 
  AND (
    user_id = auth.uid() 
    OR has_high_level_role(auth.uid())
  )
);

-- Policy: Only high-level roles can insert rewards
CREATE POLICY "High level roles can create rewards"
ON public.achievement_rewards
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = get_user_tenant_id()
  AND has_high_level_role(auth.uid())
);

-- Policy: Only high-level roles can update rewards
CREATE POLICY "High level roles can update rewards"
ON public.achievement_rewards
FOR UPDATE
TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND has_high_level_role(auth.uid())
);

-- Policy: Only high-level roles can delete rewards
CREATE POLICY "High level roles can delete rewards"
ON public.achievement_rewards
FOR DELETE
TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND has_high_level_role(auth.uid())
);