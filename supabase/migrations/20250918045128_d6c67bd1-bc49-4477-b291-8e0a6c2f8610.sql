-- First create the calls table that's referenced in the dialer migration
CREATE TABLE public.calls (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    contact_id UUID REFERENCES public.contacts(id),
    from_number TEXT,
    to_number TEXT,
    direction TEXT CHECK (direction IN ('inbound', 'outbound')),
    status TEXT,
    duration INTEGER DEFAULT 0,
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on calls table
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for calls
CREATE POLICY "Users can view calls in their tenant" 
ON public.calls FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create calls in their tenant" 
ON public.calls FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update calls in their tenant" 
ON public.calls FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete calls in their tenant" 
ON public.calls FOR DELETE 
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create trigger for updated_at
CREATE TRIGGER update_calls_updated_at
    BEFORE UPDATE ON public.calls
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();