-- Company Template Settings for tenant-specific branding
CREATE TABLE IF NOT EXISTS company_template_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  template_slug TEXT,
  company_name TEXT,
  company_logo_url TEXT,
  company_address TEXT,
  company_phone TEXT,
  company_email TEXT,
  company_license TEXT,
  primary_color TEXT DEFAULT '#2563eb',
  accent_color TEXT DEFAULT '#1e40af',
  custom_header_html TEXT,
  custom_footer_html TEXT,
  default_terms TEXT,
  warranty_text TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, location_id, template_slug)
);

-- Enable RLS
ALTER TABLE company_template_settings ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Tenant members can view company template settings"
  ON company_template_settings FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant admins can manage company template settings"
  ON company_template_settings FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Add signature_envelope_id to smart_doc_instances if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'smart_doc_instances' AND column_name = 'signature_envelope_id'
  ) THEN
    ALTER TABLE smart_doc_instances ADD COLUMN signature_envelope_id UUID REFERENCES signature_envelopes(id);
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_company_template_settings_tenant ON company_template_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_company_template_settings_location ON company_template_settings(location_id);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_company_template_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_company_template_settings_updated_at ON company_template_settings;
CREATE TRIGGER trigger_company_template_settings_updated_at
  BEFORE UPDATE ON company_template_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_company_template_settings_updated_at();