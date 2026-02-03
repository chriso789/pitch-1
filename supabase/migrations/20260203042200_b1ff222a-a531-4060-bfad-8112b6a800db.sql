-- ============================================================================
-- SMARTDOCS VERSIONING AND ENVELOPE FIELDS SCHEMA
-- ============================================================================

-- Template versions for tracking template changes
CREATE TABLE IF NOT EXISTS template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES smartdoc_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  base_pdf_path TEXT,
  template_json JSONB NOT NULL DEFAULT '{}',
  header_footer_json JSONB DEFAULT '{}',
  overlay_ops JSONB DEFAULT '[]',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(template_id, version)
);

-- Document versions for edit history
CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES smart_doc_instances(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  overlay_ops JSONB NOT NULL DEFAULT '[]',
  generated_pdf_path TEXT,
  snapshot_html TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instance_id, version)
);

-- Envelope fields for positioned signature elements
CREATE TABLE IF NOT EXISTS envelope_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id UUID NOT NULL REFERENCES signature_envelopes(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES signature_recipients(id) ON DELETE SET NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('signature', 'initial', 'date', 'text', 'checkbox', 'name')),
  page INTEGER NOT NULL DEFAULT 1,
  x DECIMAL(10,2) NOT NULL,
  y DECIMAL(10,2) NOT NULL,
  width DECIMAL(10,2) NOT NULL DEFAULT 150,
  height DECIMAL(10,2) NOT NULL DEFAULT 50,
  required BOOLEAN DEFAULT true,
  smart_tag_key TEXT,
  label TEXT,
  font_size INTEGER DEFAULT 12,
  font_family TEXT DEFAULT 'Helvetica',
  metadata JSONB DEFAULT '{}',
  value TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add tenant_id to template_versions via template lookup
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Update tenant_id from parent template
UPDATE template_versions tv
SET tenant_id = st.tenant_id
FROM smartdoc_templates st
WHERE tv.template_id = st.id
  AND tv.tenant_id IS NULL;

-- Add tenant_id to document_versions via instance lookup
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Update tenant_id from parent instance
UPDATE document_versions dv
SET tenant_id = sdi.tenant_id
FROM smart_doc_instances sdi
WHERE dv.instance_id = sdi.id
  AND dv.tenant_id IS NULL;

-- Add tenant_id to envelope_fields via envelope lookup
ALTER TABLE envelope_fields ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Update tenant_id from parent envelope
UPDATE envelope_fields ef
SET tenant_id = se.tenant_id
FROM signature_envelopes se
WHERE ef.envelope_id = se.id
  AND ef.tenant_id IS NULL;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_template_versions_template_id ON template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_template_versions_tenant_id ON template_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_instance_id ON document_versions(instance_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_tenant_id ON document_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_envelope_fields_envelope_id ON envelope_fields(envelope_id);
CREATE INDEX IF NOT EXISTS idx_envelope_fields_recipient_id ON envelope_fields(recipient_id);
CREATE INDEX IF NOT EXISTS idx_envelope_fields_tenant_id ON envelope_fields(tenant_id);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Template versions: org members only
ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view template versions" ON template_versions;
CREATE POLICY "Tenant members can view template versions" ON template_versions
  FOR SELECT USING (
    tenant_id = get_user_tenant_id(auth.uid())
  );

DROP POLICY IF EXISTS "Tenant members can insert template versions" ON template_versions;
CREATE POLICY "Tenant members can insert template versions" ON template_versions
  FOR INSERT WITH CHECK (
    tenant_id = get_user_tenant_id(auth.uid())
  );

DROP POLICY IF EXISTS "Tenant members can update template versions" ON template_versions;
CREATE POLICY "Tenant members can update template versions" ON template_versions
  FOR UPDATE USING (
    tenant_id = get_user_tenant_id(auth.uid())
  );

-- Document versions: org members only
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view document versions" ON document_versions;
CREATE POLICY "Tenant members can view document versions" ON document_versions
  FOR SELECT USING (
    tenant_id = get_user_tenant_id(auth.uid())
  );

DROP POLICY IF EXISTS "Tenant members can insert document versions" ON document_versions;
CREATE POLICY "Tenant members can insert document versions" ON document_versions
  FOR INSERT WITH CHECK (
    tenant_id = get_user_tenant_id(auth.uid())
  );

DROP POLICY IF EXISTS "Tenant members can update document versions" ON document_versions;
CREATE POLICY "Tenant members can update document versions" ON document_versions
  FOR UPDATE USING (
    tenant_id = get_user_tenant_id(auth.uid())
  );

-- Envelope fields: org members only
ALTER TABLE envelope_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can manage envelope fields" ON envelope_fields;
CREATE POLICY "Tenant members can manage envelope fields" ON envelope_fields
  FOR ALL USING (
    tenant_id = get_user_tenant_id(auth.uid())
  );

-- ============================================================================
-- TRIGGERS FOR AUTO-SETTING TENANT_ID
-- ============================================================================

-- Trigger function for template_versions
CREATE OR REPLACE FUNCTION set_template_version_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM smartdoc_templates
    WHERE id = NEW.template_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS template_versions_set_tenant_id ON template_versions;
CREATE TRIGGER template_versions_set_tenant_id
  BEFORE INSERT ON template_versions
  FOR EACH ROW EXECUTE FUNCTION set_template_version_tenant_id();

-- Trigger function for document_versions
CREATE OR REPLACE FUNCTION set_document_version_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM smart_doc_instances
    WHERE id = NEW.instance_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS document_versions_set_tenant_id ON document_versions;
CREATE TRIGGER document_versions_set_tenant_id
  BEFORE INSERT ON document_versions
  FOR EACH ROW EXECUTE FUNCTION set_document_version_tenant_id();

-- Trigger function for envelope_fields
CREATE OR REPLACE FUNCTION set_envelope_field_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM signature_envelopes
    WHERE id = NEW.envelope_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS envelope_fields_set_tenant_id ON envelope_fields;
CREATE TRIGGER envelope_fields_set_tenant_id
  BEFORE INSERT ON envelope_fields
  FOR EACH ROW EXECUTE FUNCTION set_envelope_field_tenant_id();