
-- ========================================
-- Storm Properties Public - Cross-validated property records
-- ========================================
CREATE TABLE public.storm_properties_public (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_address TEXT,
  county TEXT,
  county_fips TEXT,
  state TEXT,
  parcel_id TEXT,
  owner_name TEXT,
  owner_mailing_address TEXT,
  living_sqft INTEGER,
  year_built INTEGER,
  lot_size TEXT,
  land_use TEXT,
  last_sale_date DATE,
  last_sale_amount NUMERIC,
  homestead BOOLEAN DEFAULT FALSE,
  mortgage_lender TEXT,
  assessed_value NUMERIC,
  confidence_score INTEGER DEFAULT 0,
  source_appraiser TEXT,
  source_tax TEXT,
  source_clerk TEXT,
  source_esri BOOLEAN DEFAULT FALSE,
  source_osm BOOLEAN DEFAULT FALSE,
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  canvassiq_property_id UUID,
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_storm_properties_public_tenant ON public.storm_properties_public(tenant_id);
CREATE INDEX idx_storm_properties_public_coords ON public.storm_properties_public(lat, lng);
CREATE INDEX idx_storm_properties_public_canvassiq ON public.storm_properties_public(canvassiq_property_id);
CREATE UNIQUE INDEX idx_storm_properties_public_address_tenant ON public.storm_properties_public(tenant_id, property_address) WHERE property_address IS NOT NULL;

-- Enable RLS
ALTER TABLE public.storm_properties_public ENABLE ROW LEVEL SECURITY;

-- RLS Policies - tenant isolation
CREATE POLICY "Users can view their tenant's public property data"
  ON public.storm_properties_public
  FOR SELECT
  USING (tenant_id IN (
    SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert public property data for their tenant"
  ON public.storm_properties_public
  FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update their tenant's public property data"
  ON public.storm_properties_public
  FOR UPDATE
  USING (tenant_id IN (
    SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()
  ));

-- Service role bypass for edge functions
CREATE POLICY "Service role full access to storm_properties_public"
  ON public.storm_properties_public
  FOR ALL
  USING (auth.role() = 'service_role');
