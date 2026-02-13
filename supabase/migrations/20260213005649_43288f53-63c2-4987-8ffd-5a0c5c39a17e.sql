
-- =============================================
-- 1. Create storm_lookup_queue table
-- =============================================
CREATE TABLE IF NOT EXISTS public.storm_lookup_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  storm_event_id text NOT NULL,
  polygon_id text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  address text,
  status text NOT NULL DEFAULT 'queued',
  result jsonb,
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS storm_lookup_queue_uniq
  ON public.storm_lookup_queue(tenant_id, storm_event_id, polygon_id, lat, lng);

CREATE INDEX IF NOT EXISTS idx_storm_lookup_queue_status
  ON public.storm_lookup_queue(tenant_id, storm_event_id, status);

ALTER TABLE public.storm_lookup_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for storm_lookup_queue"
  ON public.storm_lookup_queue
  FOR ALL
  USING (tenant_id IN (
    SELECT t.id FROM tenants t
    JOIN profiles p ON p.tenant_id = t.id OR p.active_tenant_id = t.id
    WHERE p.id = auth.uid()
  ));

-- =============================================
-- 2. Add columns to storm_properties_public
-- =============================================
ALTER TABLE public.storm_properties_public
  ADD COLUMN IF NOT EXISTS normalized_address_key text,
  ADD COLUMN IF NOT EXISTS used_batchleads boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS batchleads_payload jsonb;

-- Add unique constraint for upsert keying (drop old if exists, create new)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'storm_properties_public_tenant_normalized_key'
  ) THEN
    ALTER TABLE public.storm_properties_public
      ADD CONSTRAINT storm_properties_public_tenant_normalized_key
      UNIQUE (tenant_id, normalized_address_key);
  END IF;
END $$;
