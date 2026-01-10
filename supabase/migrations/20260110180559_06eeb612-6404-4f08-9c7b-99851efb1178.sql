-- ============================================================================
-- REPORT PACKETS SYSTEM - Multi-tenant report assembly and sending
-- ============================================================================

-- 1. ENUMS
-- ============================================================================

CREATE TYPE report_packet_status AS ENUM (
  'draft', 'generated', 'sent', 'viewed', 'signed', 'expired', 'void'
);

CREATE TYPE report_subject_type AS ENUM ('lead', 'job', 'contact', 'pipeline_entry', 'project');

CREATE TYPE report_file_kind AS ENUM (
  'measurement_pdf', 'estimate_pdf', 'cover_pdf', 'photos_pdf', 
  'marketing_pdf', 'signed_pdf', 'final_packet', 'separator_pdf', 'other'
);

CREATE TYPE packet_event_type AS ENUM (
  'email_sent', 'email_delivered', 'email_bounced', 'email_opened',
  'link_clicked', 'packet_viewed', 'page_viewed', 'download_clicked',
  'signature_started', 'signature_completed', 'packet_regenerated', 'packet_voided'
);

CREATE TYPE packet_actor_type AS ENUM ('internal_user', 'external_viewer', 'system');

-- 2. REPORT TEMPLATES
-- ============================================================================

CREATE TABLE report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  template_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Structure: { sections: [{type, config, order, enabled}], defaults: {} }
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_templates_tenant ON report_templates(tenant_id);
CREATE INDEX idx_report_templates_default ON report_templates(tenant_id, is_default) WHERE is_default = true;

-- 3. REPORT PACKETS (Core)
-- ============================================================================

CREATE TABLE report_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Polymorphic subject reference
  subject_type report_subject_type NOT NULL,
  subject_id UUID NOT NULL,
  
  -- Core fields
  status report_packet_status NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  message_to_client TEXT,
  expires_at TIMESTAMPTZ,
  
  -- IMMUTABLE branding snapshot (critical for tenant isolation)
  branding_snapshot JSONB NOT NULL,
  -- Structure: { company_name, logo_url, license_number, phone, email,
  --              website, address_line1, address_city, address_state, address_zip,
  --              primary_color, secondary_color, footer_disclaimer, captured_at }
  
  -- Section manifest (ordered list of included sections)
  section_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Structure: [{ section_type, order, config, file_id?, enabled, page_count? }]
  
  render_version INT NOT NULL DEFAULT 1,
  final_pdf_storage_path TEXT,
  final_pdf_hash TEXT,
  final_pdf_page_count INT,
  
  -- Template reference (optional)
  template_id UUID REFERENCES report_templates(id) ON DELETE SET NULL,
  
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_packets_tenant ON report_packets(tenant_id);
CREATE INDEX idx_report_packets_subject ON report_packets(subject_type, subject_id);
CREATE INDEX idx_report_packets_status ON report_packets(tenant_id, status);
CREATE INDEX idx_report_packets_created ON report_packets(tenant_id, created_at DESC);

-- 4. REPORT PACKET FILES
-- ============================================================================

CREATE TABLE report_packet_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  packet_id UUID NOT NULL REFERENCES report_packets(id) ON DELETE CASCADE,
  
  kind report_file_kind NOT NULL,
  storage_path TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'report-packets',
  filename TEXT NOT NULL,
  content_type TEXT DEFAULT 'application/pdf',
  byte_size BIGINT,
  sha256 TEXT,
  page_count INT,
  
  -- For imported PDFs: source info
  source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  
  -- Metadata for display
  display_name TEXT,
  section_order INT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_packet_files_packet ON report_packet_files(packet_id);
CREATE INDEX idx_report_packet_files_tenant ON report_packet_files(tenant_id);
CREATE INDEX idx_report_packet_files_kind ON report_packet_files(packet_id, kind);

-- 5. REPORT PACKET VIEWERS (External Sessions)
-- ============================================================================

CREATE TABLE report_packet_viewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  packet_id UUID NOT NULL REFERENCES report_packets(id) ON DELETE CASCADE,
  
  viewer_token TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  ip_first INET,
  ip_last INET,
  ua_first TEXT,
  ua_last TEXT,
  view_count INT DEFAULT 0,
  
  -- Token validity
  is_revoked BOOLEAN DEFAULT false,
  revoked_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_viewer_token ON report_packet_viewers(viewer_token);
CREATE INDEX idx_report_packet_viewers_packet ON report_packet_viewers(packet_id);
CREATE INDEX idx_report_packet_viewers_tenant ON report_packet_viewers(tenant_id);

-- 6. REPORT PACKET EVENTS (Tracking + Audit)
-- ============================================================================

CREATE TABLE report_packet_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  packet_id UUID NOT NULL REFERENCES report_packets(id) ON DELETE CASCADE,
  
  event_type packet_event_type NOT NULL,
  event_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  actor_type packet_actor_type NOT NULL,
  actor_user_id UUID REFERENCES profiles(id),
  viewer_id UUID REFERENCES report_packet_viewers(id),
  
  meta JSONB DEFAULT '{}'::jsonb,
  -- Structure: { ip, user_agent, referrer, page_index, dwell_ms, 
  --              resend_message_id, email_to, scroll_depth, etc. }
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_packet_events_packet ON report_packet_events(packet_id);
CREATE INDEX idx_report_packet_events_tenant ON report_packet_events(tenant_id);
CREATE INDEX idx_report_packet_events_type ON report_packet_events(packet_id, event_type);
CREATE INDEX idx_report_packet_events_ts ON report_packet_events(packet_id, event_ts DESC);

-- 7. REPORT PACKET SIGNATURES
-- ============================================================================

CREATE TABLE report_packet_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  packet_id UUID NOT NULL REFERENCES report_packets(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES report_packet_viewers(id),
  
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  signature_image_path TEXT,
  signature_vector JSONB, -- For storing stroke data if needed
  
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip INET NOT NULL,
  user_agent TEXT NOT NULL,
  consent_checked BOOLEAN NOT NULL DEFAULT true,
  consent_text TEXT,
  
  packet_render_version_signed INT NOT NULL,
  packet_hash_signed TEXT NOT NULL,
  
  -- Full audit trail
  audit_trail JSONB NOT NULL,
  -- Structure: { timestamp, ip, user_agent, consent_text, browser_info, 
  --              screen_resolution, timezone, packet_version, packet_hash,
  --              geolocation?, device_fingerprint? }
  
  -- Signed PDF reference
  signed_pdf_storage_path TEXT,
  signed_pdf_hash TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_packet_signatures_packet ON report_packet_signatures(packet_id);
CREATE INDEX idx_report_packet_signatures_tenant ON report_packet_signatures(tenant_id);
CREATE UNIQUE INDEX idx_report_packet_signatures_unique ON report_packet_signatures(packet_id) 
  WHERE signed_at IS NOT NULL; -- Only one valid signature per packet

-- 8. RLS POLICIES
-- ============================================================================

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_packet_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_packet_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_packet_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_packet_signatures ENABLE ROW LEVEL SECURITY;

-- Report Templates: Tenant members can manage
CREATE POLICY "Tenant members can manage templates" ON report_templates
  FOR ALL USING (
    tenant_id IN (
      SELECT uca.tenant_id FROM user_company_access uca 
      WHERE uca.user_id = auth.uid() AND uca.is_active = true
    )
  );

-- Report Packets: Tenant members can manage
CREATE POLICY "Tenant members can manage packets" ON report_packets
  FOR ALL USING (
    tenant_id IN (
      SELECT uca.tenant_id FROM user_company_access uca 
      WHERE uca.user_id = auth.uid() AND uca.is_active = true
    )
  );

-- Report Packet Files: Tenant members can manage
CREATE POLICY "Tenant members can manage packet files" ON report_packet_files
  FOR ALL USING (
    tenant_id IN (
      SELECT uca.tenant_id FROM user_company_access uca 
      WHERE uca.user_id = auth.uid() AND uca.is_active = true
    )
  );

-- Report Packet Viewers: Tenant members can view, system can insert
CREATE POLICY "Tenant members can manage viewers" ON report_packet_viewers
  FOR ALL USING (
    tenant_id IN (
      SELECT uca.tenant_id FROM user_company_access uca 
      WHERE uca.user_id = auth.uid() AND uca.is_active = true
    )
  );

-- Report Packet Events: Tenant members can view, system can insert
CREATE POLICY "Tenant members can view events" ON report_packet_events
  FOR SELECT USING (
    tenant_id IN (
      SELECT uca.tenant_id FROM user_company_access uca 
      WHERE uca.user_id = auth.uid() AND uca.is_active = true
    )
  );

CREATE POLICY "System can insert events" ON report_packet_events
  FOR INSERT WITH CHECK (true);

-- Report Packet Signatures: Tenant members can view
CREATE POLICY "Tenant members can view signatures" ON report_packet_signatures
  FOR SELECT USING (
    tenant_id IN (
      SELECT uca.tenant_id FROM user_company_access uca 
      WHERE uca.user_id = auth.uid() AND uca.is_active = true
    )
  );

CREATE POLICY "System can insert signatures" ON report_packet_signatures
  FOR INSERT WITH CHECK (true);

-- 9. STORAGE BUCKET
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-packets',
  'report-packets',
  false,
  52428800, -- 50MB limit
  ARRAY['application/pdf', 'image/png', 'image/jpeg']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for report-packets bucket
CREATE POLICY "Tenant members can upload to report-packets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'report-packets' AND
  (storage.foldername(name))[1] IN (
    SELECT uca.tenant_id::text FROM user_company_access uca 
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
  )
);

CREATE POLICY "Tenant members can read from report-packets"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'report-packets' AND
  (storage.foldername(name))[1] IN (
    SELECT uca.tenant_id::text FROM user_company_access uca 
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
  )
);

CREATE POLICY "Tenant members can delete from report-packets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'report-packets' AND
  (storage.foldername(name))[1] IN (
    SELECT uca.tenant_id::text FROM user_company_access uca 
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
  )
);

-- 10. UPDATED_AT TRIGGERS
-- ============================================================================

CREATE TRIGGER update_report_templates_updated_at
  BEFORE UPDATE ON report_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_report_packets_updated_at
  BEFORE UPDATE ON report_packets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 11. HELPER FUNCTION: Capture branding snapshot
-- ============================================================================

CREATE OR REPLACE FUNCTION capture_branding_snapshot(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_snapshot JSONB;
BEGIN
  SELECT jsonb_build_object(
    'company_name', t.name,
    'logo_url', t.logo_url,
    'license_number', t.license_number,
    'phone', t.phone,
    'email', t.support_email,
    'website', t.website,
    'address_line1', t.address_line1,
    'address_city', t.address_city,
    'address_state', t.address_state,
    'address_zip', t.address_zip,
    'primary_color', COALESCE(t.primary_color, '#2563eb'),
    'secondary_color', COALESCE(t.secondary_color, '#1e40af'),
    'footer_disclaimer', t.default_footer_text,
    'captured_at', now()
  )
  INTO v_snapshot
  FROM tenants t
  WHERE t.id = p_tenant_id;
  
  RETURN COALESCE(v_snapshot, '{}'::jsonb);
END;
$$;

-- 12. HELPER FUNCTION: Generate secure viewer token
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_viewer_token()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  -- Generate a 32-character random token
  RETURN encode(gen_random_bytes(24), 'base64');
END;
$$;