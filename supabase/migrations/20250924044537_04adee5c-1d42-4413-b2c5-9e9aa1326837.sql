-- Add location and ghost account columns to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS current_location JSONB,
ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_ghost_account BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS created_by_master UUID REFERENCES public.profiles(id);

-- Add address verification columns to contacts
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS verified_address JSONB,
ADD COLUMN IF NOT EXISTS address_verification_data JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS created_by_ghost UUID REFERENCES public.profiles(id);

-- Create ghost account reports table
CREATE TABLE IF NOT EXISTS public.ghost_account_reports (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    ghost_account_id UUID NOT NULL REFERENCES public.profiles(id),
    activity_type TEXT NOT NULL,
    activity_data JSONB DEFAULT '{}',
    location_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on ghost account reports
ALTER TABLE public.ghost_account_reports ENABLE ROW LEVEL SECURITY;

-- RLS policies for ghost account reports
CREATE POLICY "Masters can view all ghost account reports" 
ON public.ghost_account_reports 
FOR SELECT 
USING (has_role('master'::app_role));

CREATE POLICY "System can insert ghost account reports" 
ON public.ghost_account_reports 
FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

-- Update RLS policies for contacts to handle ghost accounts
DROP POLICY IF EXISTS "Users can create contacts in their tenant" ON public.contacts;
CREATE POLICY "Users can create contacts in their tenant" 
ON public.contacts 
FOR INSERT 
WITH CHECK (
    tenant_id = get_user_tenant_id() OR 
    (created_by_ghost IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.profiles 
        WHERE id = created_by_ghost AND tenant_id = get_user_tenant_id()
    ))
);

-- Update RLS policies for profiles to handle ghost accounts
DROP POLICY IF EXISTS "Users can view profiles in their tenant" ON public.profiles;
CREATE POLICY "Users can view profiles in their tenant" 
ON public.profiles 
FOR SELECT 
USING (
    tenant_id = get_user_tenant_id() OR 
    (has_role('master'::app_role) AND is_ghost_account = true)
);

-- Function to check if location is within radius
CREATE OR REPLACE FUNCTION public.check_location_radius(
    user_location JSONB,
    target_lat NUMERIC,
    target_lng NUMERIC,
    radius_miles NUMERIC DEFAULT 50
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_lat NUMERIC;
    user_lng NUMERIC;
    distance NUMERIC;
BEGIN
    -- Extract coordinates from user location
    user_lat := (user_location->>'lat')::NUMERIC;
    user_lng := (user_location->>'lng')::NUMERIC;
    
    -- Calculate distance using Haversine formula (approximate)
    distance := 3959 * acos(
        cos(radians(user_lat)) * 
        cos(radians(target_lat)) * 
        cos(radians(target_lng) - radians(user_lng)) + 
        sin(radians(user_lat)) * 
        sin(radians(target_lat))
    );
    
    RETURN distance <= radius_miles;
END;
$$;

-- Trigger function to log ghost account activity
CREATE OR REPLACE FUNCTION public.log_ghost_account_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    ghost_profile RECORD;
BEGIN
    -- Check if this contact was created by a ghost account
    IF NEW.created_by_ghost IS NOT NULL THEN
        SELECT * INTO ghost_profile
        FROM public.profiles
        WHERE id = NEW.created_by_ghost;
        
        -- Log the activity
        INSERT INTO public.ghost_account_reports (
            tenant_id,
            ghost_account_id,
            activity_type,
            activity_data,
            location_data
        ) VALUES (
            NEW.tenant_id,
            NEW.created_by_ghost,
            'contact_created',
            jsonb_build_object(
                'contact_id', NEW.id,
                'contact_name', COALESCE(NEW.first_name || ' ' || NEW.last_name, 'Unknown'),
                'contact_address', NEW.address_street,
                'lead_source', NEW.lead_source
            ),
            ghost_profile.current_location
        );
    END IF;
    
    RETURN NEW;
END;
$$;

-- Create trigger for ghost account activity logging
DROP TRIGGER IF EXISTS log_ghost_activity ON public.contacts;
CREATE TRIGGER log_ghost_activity
    AFTER INSERT ON public.contacts
    FOR EACH ROW
    EXECUTE FUNCTION public.log_ghost_account_activity();