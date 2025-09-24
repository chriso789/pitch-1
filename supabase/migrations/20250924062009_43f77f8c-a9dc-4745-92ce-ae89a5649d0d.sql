-- Create locations table
CREATE TABLE public.locations (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    address_street TEXT,
    address_city TEXT,
    address_state TEXT,
    address_zip TEXT,
    phone TEXT,
    email TEXT,
    manager_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create user location assignments table
CREATE TABLE public.user_location_assignments (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    location_id UUID NOT NULL,
    assigned_by UUID,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(tenant_id, user_id, location_id)
);

-- Enable RLS
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_location_assignments ENABLE ROW LEVEL SECURITY;

-- RLS policies for locations
CREATE POLICY "Users can view locations in their tenant where they have access"
ON public.locations
FOR SELECT
TO authenticated
USING (
    tenant_id = get_user_tenant_id() AND (
        -- Admins and managers can see all locations
        has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role) OR
        -- Users can see locations they're assigned to
        EXISTS (
            SELECT 1 FROM public.user_location_assignments ula
            WHERE ula.tenant_id = get_user_tenant_id()
            AND ula.user_id = auth.uid()
            AND ula.location_id = locations.id
            AND ula.is_active = true
        )
    )
);

CREATE POLICY "Admins can manage locations in their tenant"
ON public.locations
FOR ALL
TO authenticated
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)))
WITH CHECK (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- RLS policies for user location assignments
CREATE POLICY "Users can view their own location assignments"
ON public.user_location_assignments
FOR SELECT
TO authenticated
USING (
    tenant_id = get_user_tenant_id() AND (
        user_id = auth.uid() OR
        has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)
    )
);

CREATE POLICY "Admins can manage location assignments in their tenant"
ON public.user_location_assignments
FOR ALL
TO authenticated
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)))
WITH CHECK (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Add triggers for updated_at
CREATE TRIGGER update_locations_updated_at
    BEFORE UPDATE ON public.locations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Add location_id to existing tables for location-based filtering
ALTER TABLE public.contacts ADD COLUMN location_id UUID;
ALTER TABLE public.pipeline_entries ADD COLUMN location_id UUID;
ALTER TABLE public.projects ADD COLUMN location_id UUID;

-- Add current location context to app_settings
INSERT INTO public.app_settings (user_id, tenant_id, setting_key, setting_value)
SELECT 
    p.id,
    p.tenant_id,
    'current_location_id',
    'null'::jsonb
FROM public.profiles p
WHERE NOT EXISTS (
    SELECT 1 FROM public.app_settings s 
    WHERE s.user_id = p.id AND s.setting_key = 'current_location_id'
);