-- ============================================
-- CanvassIQ Database Schema
-- Phase 2: Core tables, RLS policies, indexes
-- ============================================

-- Enable PostGIS extension if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================
-- 1. canvassiq_properties - Property records with PostGIS
-- ============================================
CREATE TABLE IF NOT EXISTS canvassiq_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  
  -- Google Places data
  place_id TEXT,
  address_hash TEXT NOT NULL, -- MD5 hash for deduplication
  
  -- Address components
  address JSONB NOT NULL DEFAULT '{}',
  
  -- Coordinates
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  geom GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED,
  
  -- Homeowner data
  homeowner JSONB DEFAULT '{}',
  
  -- Property data
  property_data JSONB DEFAULT '{}',
  
  -- Current disposition
  disposition TEXT DEFAULT 'new',
  disposition_updated_at TIMESTAMPTZ,
  disposition_updated_by UUID REFERENCES profiles(id),
  
  -- Flags and tags
  flags JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  
  -- Enrichment tracking
  enrichment_source TEXT[] DEFAULT '{}',
  enrichment_cost DECIMAL(10,4) DEFAULT 0,
  enrichment_confidence INTEGER,
  enrichment_last_at TIMESTAMPTZ,
  firecrawl_data JSONB,
  searchbug_data JSONB,
  
  -- Extracted fields for quick access
  owner_name TEXT,
  phone_numbers TEXT[] DEFAULT '{}',
  emails TEXT[] DEFAULT '{}',
  
  -- Metadata
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for canvassiq_properties
CREATE INDEX IF NOT EXISTS idx_canvassiq_properties_tenant ON canvassiq_properties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_canvassiq_properties_geom ON canvassiq_properties USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_canvassiq_properties_address_hash ON canvassiq_properties(tenant_id, address_hash);
CREATE INDEX IF NOT EXISTS idx_canvassiq_properties_disposition ON canvassiq_properties(tenant_id, disposition);
CREATE INDEX IF NOT EXISTS idx_canvassiq_properties_created ON canvassiq_properties(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvassiq_properties_contact ON canvassiq_properties(contact_id) WHERE contact_id IS NOT NULL;

-- RLS for canvassiq_properties
ALTER TABLE canvassiq_properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvassiq_properties_select"
  ON canvassiq_properties FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "canvassiq_properties_insert"
  ON canvassiq_properties FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "canvassiq_properties_update"
  ON canvassiq_properties FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "canvassiq_properties_delete"
  ON canvassiq_properties FOR DELETE
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

-- ============================================
-- 2. canvassiq_visits - Visit records
-- ============================================
CREATE TABLE IF NOT EXISTS canvassiq_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES canvassiq_properties(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  
  visit_type TEXT NOT NULL DEFAULT 'door_knock',
  disposition TEXT NOT NULL,
  notes TEXT,
  
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy_meters DOUBLE PRECISION,
  
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvassiq_visits_tenant ON canvassiq_visits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_canvassiq_visits_property ON canvassiq_visits(property_id);
CREATE INDEX IF NOT EXISTS idx_canvassiq_visits_user ON canvassiq_visits(user_id);
CREATE INDEX IF NOT EXISTS idx_canvassiq_visits_created ON canvassiq_visits(tenant_id, created_at DESC);

ALTER TABLE canvassiq_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvassiq_visits_select"
  ON canvassiq_visits FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "canvassiq_visits_insert"
  ON canvassiq_visits FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "canvassiq_visits_update"
  ON canvassiq_visits FOR UPDATE
  USING (user_id = auth.uid());

-- ============================================
-- 3. canvassiq_outbox - Event queue for PITCH sync
-- ============================================
CREATE TABLE IF NOT EXISTS canvassiq_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  error_message TEXT,
  result JSONB,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvassiq_outbox_tenant ON canvassiq_outbox(tenant_id);
CREATE INDEX IF NOT EXISTS idx_canvassiq_outbox_status ON canvassiq_outbox(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_canvassiq_outbox_created ON canvassiq_outbox(created_at);

ALTER TABLE canvassiq_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvassiq_outbox_select"
  ON canvassiq_outbox FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "canvassiq_outbox_insert"
  ON canvassiq_outbox FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ============================================
-- 4. canvassiq_enrichment_logs - Track enrichment usage/costs
-- ============================================
CREATE TABLE IF NOT EXISTS canvassiq_enrichment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id UUID REFERENCES canvassiq_properties(id) ON DELETE SET NULL,
  user_id UUID REFERENCES profiles(id),
  provider TEXT NOT NULL,
  endpoint TEXT,
  request_payload JSONB,
  response_status INTEGER,
  response_data JSONB,
  cost DECIMAL(10,4) DEFAULT 0,
  credits_used INTEGER DEFAULT 0,
  success BOOLEAN DEFAULT false,
  confidence INTEGER,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvassiq_enrichment_tenant ON canvassiq_enrichment_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_canvassiq_enrichment_property ON canvassiq_enrichment_logs(property_id);
CREATE INDEX IF NOT EXISTS idx_canvassiq_enrichment_provider ON canvassiq_enrichment_logs(tenant_id, provider);
CREATE INDEX IF NOT EXISTS idx_canvassiq_enrichment_created ON canvassiq_enrichment_logs(created_at DESC);

ALTER TABLE canvassiq_enrichment_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvassiq_enrichment_select"
  ON canvassiq_enrichment_logs FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "canvassiq_enrichment_insert"
  ON canvassiq_enrichment_logs FOR INSERT
  WITH CHECK (true);

-- ============================================
-- 5. canvassiq_rate_limits - Per-user rate limiting
-- ============================================
CREATE TABLE IF NOT EXISTS canvassiq_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  max_per_hour INTEGER DEFAULT 100,
  max_per_day INTEGER DEFAULT 500,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, action_type)
);

ALTER TABLE canvassiq_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvassiq_rate_limits_select"
  ON canvassiq_rate_limits FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "canvassiq_rate_limits_all"
  ON canvassiq_rate_limits FOR ALL
  USING (true);

-- ============================================
-- RPC Functions
-- ============================================

CREATE OR REPLACE FUNCTION get_canvassiq_properties_in_bbox(
  p_tenant_id UUID,
  p_min_lng DOUBLE PRECISION,
  p_min_lat DOUBLE PRECISION,
  p_max_lng DOUBLE PRECISION,
  p_max_lat DOUBLE PRECISION,
  p_limit INTEGER DEFAULT 500
)
RETURNS SETOF canvassiq_properties
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT *
  FROM canvassiq_properties
  WHERE tenant_id = p_tenant_id
    AND lng BETWEEN p_min_lng AND p_max_lng
    AND lat BETWEEN p_min_lat AND p_max_lat
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION add_canvassiq_property(
  p_tenant_id UUID,
  p_address JSONB,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_place_id TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_address_hash TEXT;
  v_existing_id UUID;
  v_new_id UUID;
BEGIN
  v_address_hash := MD5(LOWER(TRIM(p_address->>'formatted')));
  
  SELECT id INTO v_existing_id
  FROM canvassiq_properties
  WHERE tenant_id = p_tenant_id AND address_hash = v_address_hash
  LIMIT 1;
  
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;
  
  INSERT INTO canvassiq_properties (
    tenant_id, address_hash, address, lat, lng, place_id, created_by
  ) VALUES (
    p_tenant_id, v_address_hash, p_address, p_lat, p_lng, p_place_id, p_created_by
  )
  RETURNING id INTO v_new_id;
  
  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_canvassiq_property_to_contact(p_property_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_property canvassiq_properties;
  v_contact_id UUID;
  v_first_name TEXT;
  v_last_name TEXT;
BEGIN
  SELECT * INTO v_property FROM canvassiq_properties WHERE id = p_property_id;
  
  IF v_property.id IS NULL THEN
    RAISE EXCEPTION 'Property not found';
  END IF;
  
  IF v_property.contact_id IS NOT NULL THEN
    RETURN v_property.contact_id;
  END IF;
  
  IF v_property.owner_name IS NOT NULL THEN
    v_first_name := SPLIT_PART(v_property.owner_name, ' ', 1);
    v_last_name := REGEXP_REPLACE(v_property.owner_name, '^' || v_first_name || '\s*', '');
    IF v_last_name = '' THEN v_last_name := 'Unknown'; END IF;
  ELSE
    v_first_name := 'Property';
    v_last_name := 'Owner';
  END IF;
  
  INSERT INTO contacts (
    tenant_id, first_name, last_name, email, phone,
    address_street, address_city, address_state, address_zip,
    latitude, longitude, lead_source, notes, created_by
  ) VALUES (
    v_property.tenant_id, v_first_name, v_last_name,
    COALESCE(v_property.emails[1], NULL),
    COALESCE(v_property.phone_numbers[1], NULL),
    v_property.address->>'street_number' || ' ' || v_property.address->>'street',
    v_property.address->>'city', v_property.address->>'state', v_property.address->>'zip',
    v_property.lat, v_property.lng, 'Door Knock',
    'Created from CanvassIQ property', v_property.created_by
  )
  RETURNING id INTO v_contact_id;
  
  UPDATE canvassiq_properties SET contact_id = v_contact_id, updated_at = NOW() WHERE id = p_property_id;
  
  INSERT INTO canvassiq_outbox (tenant_id, event_type, payload)
  VALUES (v_property.tenant_id, 'sync_to_contact', jsonb_build_object('property_id', p_property_id, 'contact_id', v_contact_id));
  
  RETURN v_contact_id;
END;
$$;

-- Trigger to update property disposition from visits
CREATE OR REPLACE FUNCTION update_property_disposition_from_visit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE canvassiq_properties
  SET disposition = NEW.disposition, disposition_updated_at = NEW.created_at,
      disposition_updated_by = NEW.user_id, updated_at = NOW()
  WHERE id = NEW.property_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_property_disposition ON canvassiq_visits;
CREATE TRIGGER trg_update_property_disposition
  AFTER INSERT ON canvassiq_visits
  FOR EACH ROW
  EXECUTE FUNCTION update_property_disposition_from_visit();

-- Trigger to queue outbox event on disposition change
CREATE OR REPLACE FUNCTION queue_disposition_change_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.disposition IS DISTINCT FROM NEW.disposition THEN
    INSERT INTO canvassiq_outbox (tenant_id, event_type, payload)
    VALUES (NEW.tenant_id, 'disposition_changed',
      jsonb_build_object('property_id', NEW.id, 'old_disposition', OLD.disposition,
        'new_disposition', NEW.disposition, 'updated_by', NEW.disposition_updated_by));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_disposition_change ON canvassiq_properties;
CREATE TRIGGER trg_queue_disposition_change
  AFTER UPDATE OF disposition ON canvassiq_properties
  FOR EACH ROW
  EXECUTE FUNCTION queue_disposition_change_event();