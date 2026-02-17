-- Add scores JSONB column to storm_properties_public
ALTER TABLE storm_properties_public ADD COLUMN IF NOT EXISTS scores jsonb;

-- Create DNC scrub results table
CREATE TABLE IF NOT EXISTS dnc_scrub_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  phone_e164 text NOT NULL,
  is_dnc boolean,
  is_wireless boolean,
  source text,
  scrubbed_at timestamptz DEFAULT now(),
  raw jsonb,
  UNIQUE(tenant_id, phone_e164)
);

ALTER TABLE dnc_scrub_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant DNC data"
  ON dnc_scrub_results FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
    UNION SELECT active_tenant_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Service role can manage DNC data"
  ON dnc_scrub_results FOR ALL
  USING (true)
  WITH CHECK (true);
