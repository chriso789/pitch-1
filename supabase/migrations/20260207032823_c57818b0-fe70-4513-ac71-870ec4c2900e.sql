-- Create contact_statuses table for managing contact qualification dispositions
-- This is SEPARATE from pipeline_stages which manages workflow progression

CREATE TABLE public.contact_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6b7280',
  category TEXT NOT NULL DEFAULT 'disposition',
  status_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, key)
);

-- Enable RLS
ALTER TABLE public.contact_statuses ENABLE ROW LEVEL SECURITY;

-- SELECT policy: All authenticated users in tenant can view
CREATE POLICY "Users can view contact statuses in their tenant"
ON public.contact_statuses
FOR SELECT
USING (tenant_id = get_user_tenant_id());

-- INSERT policy: Managers can create
CREATE POLICY "Managers can create contact statuses"
ON public.contact_statuses
FOR INSERT
WITH CHECK (
  tenant_id = get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
);

-- UPDATE policy: Managers can update
CREATE POLICY "Managers can update contact statuses"
ON public.contact_statuses
FOR UPDATE
USING (
  tenant_id = get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
)
WITH CHECK (tenant_id = get_user_tenant_id());

-- DELETE policy: Managers can delete non-system statuses
CREATE POLICY "Managers can delete contact statuses"
ON public.contact_statuses
FOR DELETE
USING (
  tenant_id = get_user_tenant_id()
  AND is_system = false
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
);

-- Add index for performance
CREATE INDEX idx_contact_statuses_tenant ON public.contact_statuses(tenant_id);
CREATE INDEX idx_contact_statuses_active ON public.contact_statuses(tenant_id, is_active);