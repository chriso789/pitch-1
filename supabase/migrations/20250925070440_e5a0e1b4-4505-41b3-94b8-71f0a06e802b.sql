-- Create deleted contacts secure storage table
CREATE TABLE public.deleted_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  original_contact_id UUID NOT NULL,
  contact_data JSONB NOT NULL,
  deleted_by UUID,
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deletion_reason TEXT,
  access_level TEXT DEFAULT 'master_only'
);

-- Enable RLS on deleted_contacts
ALTER TABLE public.deleted_contacts ENABLE ROW LEVEL SECURITY;

-- Create policy for deleted contacts (master only access)
CREATE POLICY "Masters can manage deleted contacts" 
ON public.deleted_contacts 
FOR ALL 
USING (has_role('master'::app_role));

-- Create production stages table
CREATE TABLE public.production_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  icon TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on production_stages
ALTER TABLE public.production_stages ENABLE ROW LEVEL SECURITY;

-- Create policies for production stages
CREATE POLICY "Users can view production stages in their tenant" 
ON public.production_stages 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage production stages in their tenant" 
ON public.production_stages 
FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Enhance production_workflows table
ALTER TABLE public.production_workflows ADD COLUMN IF NOT EXISTS stage_data JSONB DEFAULT '{}';
ALTER TABLE public.production_workflows ADD COLUMN IF NOT EXISTS documents_uploaded JSONB DEFAULT '[]';
ALTER TABLE public.production_workflows ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]';
ALTER TABLE public.production_workflows ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Add soft delete to contacts table
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS deleted_by UUID;

-- Update contacts RLS policy to filter out deleted contacts
DROP POLICY IF EXISTS "Users can view contacts in their tenant" ON public.contacts;
CREATE POLICY "Users can view active contacts in their tenant" 
ON public.contacts 
FOR SELECT 
USING (
  tenant_id = get_user_tenant_id() 
  AND is_deleted = false 
  AND (
    has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role) 
    OR location_id IS NULL 
    OR EXISTS (
      SELECT 1 FROM user_location_assignments ula 
      WHERE ula.tenant_id = get_user_tenant_id() 
      AND ula.user_id = auth.uid() 
      AND ula.location_id = contacts.location_id 
      AND ula.is_active = true
    )
  )
);

-- Create function to handle contact soft delete
CREATE OR REPLACE FUNCTION public.soft_delete_contact(contact_id_param UUID)
RETURNS BOOLEAN AS $$
DECLARE
  contact_record RECORD;
BEGIN
  -- Get the contact record
  SELECT * INTO contact_record
  FROM public.contacts
  WHERE id = contact_id_param AND tenant_id = get_user_tenant_id();
  
  IF contact_record IS NULL THEN
    RAISE EXCEPTION 'Contact not found or access denied';
  END IF;
  
  -- Archive the contact data
  INSERT INTO public.deleted_contacts (
    tenant_id,
    original_contact_id,
    contact_data,
    deleted_by,
    deletion_reason
  ) VALUES (
    contact_record.tenant_id,
    contact_record.id,
    to_jsonb(contact_record),
    auth.uid(),
    'Soft deleted by user'
  );
  
  -- Mark contact as deleted
  UPDATE public.contacts 
  SET 
    is_deleted = true,
    deleted_at = now(),
    deleted_by = auth.uid()
  WHERE id = contact_id_param AND tenant_id = get_user_tenant_id();
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for updated_at on production_stages
CREATE OR REPLACE TRIGGER update_production_stages_updated_at
BEFORE UPDATE ON public.production_stages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();