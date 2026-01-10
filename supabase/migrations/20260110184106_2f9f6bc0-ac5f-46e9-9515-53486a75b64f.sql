-- Homeowner Portal Activity Log Table
-- Track every action homeowners take in the portal
CREATE TABLE IF NOT EXISTS public.homeowner_portal_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id UUID REFERENCES homeowner_portal_sessions(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  
  action_type TEXT NOT NULL,
  action_details JSONB DEFAULT '{}',
  
  ip_address INET,
  user_agent TEXT,
  device_type TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_portal_activity_contact ON homeowner_portal_activity(contact_id);
CREATE INDEX IF NOT EXISTS idx_portal_activity_tenant ON homeowner_portal_activity(tenant_id);
CREATE INDEX IF NOT EXISTS idx_portal_activity_created ON homeowner_portal_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_activity_session ON homeowner_portal_activity(session_id);

-- Homeowner Portal Permissions Table
CREATE TABLE IF NOT EXISTS public.homeowner_portal_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  
  can_view_project_status BOOLEAN DEFAULT true,
  can_view_timeline BOOLEAN DEFAULT true,
  can_view_photos BOOLEAN DEFAULT true,
  can_view_documents BOOLEAN DEFAULT true,
  can_download_documents BOOLEAN DEFAULT true,
  can_view_estimates BOOLEAN DEFAULT false,
  can_view_payments BOOLEAN DEFAULT true,
  can_send_messages BOOLEAN DEFAULT true,
  can_approve_change_orders BOOLEAN DEFAULT true,
  can_use_ai_chat BOOLEAN DEFAULT true,
  
  visible_document_categories TEXT[] DEFAULT ARRAY['contracts', 'invoices', 'photos'],
  visible_photo_categories TEXT[] DEFAULT ARRAY['progress', 'before', 'after'],
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(contact_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_permissions_tenant ON homeowner_portal_permissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_portal_permissions_contact ON homeowner_portal_permissions(contact_id);

-- Enable RLS
ALTER TABLE homeowner_portal_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE homeowner_portal_permissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for homeowner_portal_activity
CREATE POLICY "Tenant users can view portal activity"
  ON homeowner_portal_activity
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM profiles p
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Tenant users can insert portal activity"
  ON homeowner_portal_activity
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM profiles p
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Homeowners can log their own activity"
  ON homeowner_portal_activity
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homeowner_portal_sessions s
      WHERE s.id = session_id
      AND s.contact_id = homeowner_portal_activity.contact_id
      AND s.expires_at > now()
    )
  );

-- RLS Policies for homeowner_portal_permissions
CREATE POLICY "Tenant users can view portal permissions"
  ON homeowner_portal_permissions
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM profiles p
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Tenant users can manage portal permissions"
  ON homeowner_portal_permissions
  FOR ALL
  USING (
    tenant_id IN (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM profiles p
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Homeowners can view their own permissions"
  ON homeowner_portal_permissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homeowner_portal_sessions s
      WHERE s.contact_id = homeowner_portal_permissions.contact_id
      AND s.expires_at > now()
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_portal_permissions_updated_at
  BEFORE UPDATE ON homeowner_portal_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();