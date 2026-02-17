
-- public_property_cache: dedicated cache for public property data
CREATE TABLE IF NOT EXISTS public_property_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  normalized_address_key text NOT NULL,
  state text NOT NULL,
  county text,
  county_fips text,
  state_fips text,
  parcel_id text,
  owner_name text,
  mailing_address text,
  homestead boolean,
  assessed_value numeric,
  last_sale_date date,
  last_sale_amount numeric,
  year_built int,
  raw_county_payload jsonb,
  source text,
  confidence_score int DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, normalized_address_key)
);

CREATE INDEX IF NOT EXISTS idx_public_property_cache_tenant_addr
  ON public_property_cache (tenant_id, normalized_address_key);

ALTER TABLE public_property_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view public property cache"
  ON public_property_cache FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
    UNION SELECT active_tenant_id FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  ));
CREATE POLICY "Tenant members can insert public property cache"
  ON public_property_cache FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
    UNION SELECT active_tenant_id FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  ));

-- contact_enrichment_cache: stores BatchData skip trace results
CREATE TABLE IF NOT EXISTS contact_enrichment_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  normalized_address_key text NOT NULL,
  owner_name text,
  phones jsonb,
  emails jsonb,
  relatives jsonb,
  age int,
  batchdata_payload jsonb,
  cost numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, normalized_address_key)
);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_cache_tenant_addr
  ON contact_enrichment_cache (tenant_id, normalized_address_key);

ALTER TABLE contact_enrichment_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view contact enrichment cache"
  ON contact_enrichment_cache FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
    UNION SELECT active_tenant_id FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  ));
CREATE POLICY "Tenant members can insert contact enrichment cache"
  ON contact_enrichment_cache FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
    UNION SELECT active_tenant_id FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  ));

-- property_scores_cache: caches computed scoring engine results
CREATE TABLE IF NOT EXISTS property_scores_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  normalized_address_key text NOT NULL,
  equity_score int NOT NULL DEFAULT 0,
  equity_reasons text[] NOT NULL DEFAULT '{}',
  absentee_score int NOT NULL DEFAULT 0,
  absentee_reasons text[] NOT NULL DEFAULT '{}',
  roof_age_score int NOT NULL DEFAULT 0,
  roof_age_reasons text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, normalized_address_key)
);

CREATE INDEX IF NOT EXISTS idx_property_scores_cache_tenant_addr
  ON property_scores_cache (tenant_id, normalized_address_key);

ALTER TABLE property_scores_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view property scores cache"
  ON property_scores_cache FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
    UNION SELECT active_tenant_id FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  ));
CREATE POLICY "Tenant members can insert property scores cache"
  ON property_scores_cache FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
    UNION SELECT active_tenant_id FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  ));

-- canvass_strategy_log: audit trail for AI door knock strategies
CREATE TABLE IF NOT EXISTS canvass_strategy_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  property_id uuid,
  normalized_address_key text NOT NULL,
  request_context jsonb,
  strategy jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canvass_strategy_log_tenant_addr
  ON canvass_strategy_log (tenant_id, normalized_address_key);
CREATE INDEX IF NOT EXISTS idx_canvass_strategy_log_property
  ON canvass_strategy_log (property_id);

ALTER TABLE canvass_strategy_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view strategy logs"
  ON canvass_strategy_log FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
    UNION SELECT active_tenant_id FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  ));
CREATE POLICY "Tenant members can insert strategy logs"
  ON canvass_strategy_log FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
    UNION SELECT active_tenant_id FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  ));
