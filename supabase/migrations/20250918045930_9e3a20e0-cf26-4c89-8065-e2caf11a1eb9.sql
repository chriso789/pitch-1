-- Update profiles table to support developer access and company switching
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_developer BOOLEAN DEFAULT false;

-- Create developer access table for multi-tenant access
CREATE TABLE IF NOT EXISTS public.developer_access_grants (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    developer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES public.profiles(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    is_active BOOLEAN DEFAULT true,
    access_type TEXT DEFAULT 'full',
    UNIQUE(developer_id, tenant_id)
);

-- Enable RLS
ALTER TABLE public.developer_access_grants ENABLE ROW LEVEL SECURITY;

-- RLS policies for developer access grants
CREATE POLICY "Developers can view their own access grants"
ON public.developer_access_grants FOR SELECT
USING (developer_id = auth.uid());

CREATE POLICY "Masters can manage all developer access grants"
ON public.developer_access_grants FOR ALL
USING (has_role('master'::app_role));

-- Update the specific user to be a master developer
UPDATE public.profiles 
SET 
    role = 'master'::app_role,
    is_developer = true,
    company_name = 'O''Brien Contracting',
    title = 'Master Developer'
WHERE email = 'chrisobrien91@gmail.com';

-- Create updated get_user_tenant_id function that supports developer access
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
  -- For developers, return the currently selected tenant or their own tenant
  SELECT COALESCE(
    -- Check if there's a developer session variable for tenant switching
    current_setting('app.current_tenant_id', true)::uuid,
    -- Fall back to user's own tenant
    (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );
$function$;

-- Create function to switch tenant context for developers
CREATE OR REPLACE FUNCTION public.switch_developer_context(target_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
    user_profile RECORD;
    has_access BOOLEAN := false;
BEGIN
    -- Get current user profile
    SELECT * INTO user_profile
    FROM public.profiles
    WHERE id = auth.uid();
    
    -- Check if user is a developer
    IF NOT user_profile.is_developer THEN
        RAISE EXCEPTION 'Access denied: User is not a developer';
    END IF;
    
    -- Check if developer has access to target tenant
    SELECT EXISTS(
        SELECT 1 FROM public.developer_access_grants
        WHERE developer_id = auth.uid()
        AND tenant_id = target_tenant_id
        AND is_active = true
    ) INTO has_access;
    
    -- Masters have access to all tenants
    IF user_profile.role = 'master'::app_role THEN
        has_access := true;
    END IF;
    
    IF NOT has_access THEN
        RAISE EXCEPTION 'Access denied: No permission for tenant %', target_tenant_id;
    END IF;
    
    -- Set the tenant context
    PERFORM set_config('app.current_tenant_id', target_tenant_id::text, false);
    
    RETURN true;
END;
$function$;

-- Create app settings table for user preferences
CREATE TABLE IF NOT EXISTS public.app_settings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, tenant_id, setting_key)
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies for app settings
CREATE POLICY "Users can manage their own settings"
ON public.app_settings FOR ALL
USING (user_id = auth.uid());

-- Create trigger for updated_at
CREATE TRIGGER update_app_settings_updated_at
    BEFORE UPDATE ON public.app_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();