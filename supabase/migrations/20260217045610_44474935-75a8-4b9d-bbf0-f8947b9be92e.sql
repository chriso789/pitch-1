
-- Step 2: Create canvass_property_contacts table for BatchData skip trace cache
CREATE TABLE public.canvass_property_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES canvassiq_properties(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  primary_phone TEXT,
  secondary_phone TEXT,
  phone_numbers JSONB DEFAULT '[]',
  emails TEXT[] DEFAULT '{}',
  age INTEGER,
  relatives TEXT[] DEFAULT '{}',
  batchdata_raw JSONB,
  enriched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(property_id)
);

-- RLS: tenant isolation via property join
ALTER TABLE public.canvass_property_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view contacts for their tenant properties"
  ON public.canvass_property_contacts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM canvassiq_properties cp
      WHERE cp.id = canvass_property_contacts.property_id
        AND cp.tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can insert contacts for their tenant properties"
  ON public.canvass_property_contacts
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM canvassiq_properties cp
      WHERE cp.id = canvass_property_contacts.property_id
        AND cp.tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can update contacts for their tenant properties"
  ON public.canvass_property_contacts
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM canvassiq_properties cp
      WHERE cp.id = canvass_property_contacts.property_id
        AND cp.tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    )
  );

-- Index for fast lookups
CREATE INDEX idx_canvass_property_contacts_property_id ON public.canvass_property_contacts(property_id);
CREATE INDEX idx_canvass_property_contacts_enriched_at ON public.canvass_property_contacts(enriched_at);
