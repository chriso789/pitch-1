-- Update get_user_tenant_id() to respect active_tenant_id from company switcher
-- This ensures RLS policies filter data correctly when users switch companies

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    -- 1. Developer override via session setting
    NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
    -- 2. Active tenant from company switcher (UI sets this via switch_active_tenant)
    (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid()),
    -- 3. Fallback to user's home tenant
    (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );
$$;