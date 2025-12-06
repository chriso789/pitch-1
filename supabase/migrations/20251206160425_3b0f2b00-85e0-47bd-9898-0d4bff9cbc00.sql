-- ============================================================================
-- SMARTDOCS: Share Links & View Events Tables
-- ============================================================================

-- 1. share_links table (for trackable document links)
CREATE TABLE IF NOT EXISTS share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('document', 'envelope', 'template', 'smart_doc_instance', 'signature_envelope')),
    target_id UUID NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    permissions TEXT NOT NULL DEFAULT 'view' CHECK (permissions IN ('view', 'sign', 'edit')),
    recipient_email TEXT,
    recipient_id UUID,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES profiles(id),
    max_views INTEGER,
    view_count INTEGER DEFAULT 0,
    created_by UUID NOT NULL REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ
);

-- 2. view_events table (track every document view)
CREATE TABLE IF NOT EXISTS view_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    share_link_id UUID NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id UUID NOT NULL,
    viewer_email TEXT,
    viewer_name TEXT,
    ip_address INET,
    user_agent TEXT,
    geolocation JSONB,
    referrer TEXT,
    session_id TEXT,
    viewed_at TIMESTAMPTZ DEFAULT NOW(),
    duration_seconds INTEGER,
    metadata JSONB DEFAULT '{}'
);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_share_links_token_hash ON share_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_share_links_tenant_id ON share_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_share_links_target ON share_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_view_events_share_link_id ON view_events(share_link_id);
CREATE INDEX IF NOT EXISTS idx_view_events_tenant_id ON view_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_view_events_viewed_at ON view_events(viewed_at DESC);

-- 4. RLS Policies
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE view_events ENABLE ROW LEVEL SECURITY;

-- Share links policies
CREATE POLICY "Users can view share links in their tenant"
ON share_links FOR SELECT
USING (
    tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid())
    OR tenant_id = (SELECT p.active_tenant_id FROM profiles p WHERE p.id = auth.uid())
    OR EXISTS (SELECT 1 FROM user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = share_links.tenant_id AND uca.is_active = true)
);

CREATE POLICY "Users can create share links in their tenant"
ON share_links FOR INSERT
WITH CHECK (
    tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid())
    OR tenant_id = (SELECT p.active_tenant_id FROM profiles p WHERE p.id = auth.uid())
    OR EXISTS (SELECT 1 FROM user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = share_links.tenant_id AND uca.is_active = true)
);

CREATE POLICY "Creator or admin can update share link"
ON share_links FOR UPDATE
USING (
    created_by = auth.uid() 
    OR tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid())
    OR tenant_id = (SELECT p.active_tenant_id FROM profiles p WHERE p.id = auth.uid())
);

CREATE POLICY "Creator or admin can delete share link"
ON share_links FOR DELETE
USING (
    created_by = auth.uid() 
    OR tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid())
    OR tenant_id = (SELECT p.active_tenant_id FROM profiles p WHERE p.id = auth.uid())
);

-- View events policies
CREATE POLICY "Users can view events in their tenant"
ON view_events FOR SELECT
USING (
    tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid())
    OR tenant_id = (SELECT p.active_tenant_id FROM profiles p WHERE p.id = auth.uid())
    OR EXISTS (SELECT 1 FROM user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = view_events.tenant_id AND uca.is_active = true)
);