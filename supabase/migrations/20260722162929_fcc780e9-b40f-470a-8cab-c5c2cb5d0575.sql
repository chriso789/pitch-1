
ALTER TABLE public.sms_blast_items
  ADD COLUMN IF NOT EXISTS quarantine_reason text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sms_blast_items_quarantined
  ON public.sms_blast_items (blast_id) WHERE status = 'quarantined';

ALTER TABLE public.sms_blasts
  ADD COLUMN IF NOT EXISTS quarantined_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.sms_item_quarantine_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  blast_id uuid NOT NULL,
  item_id uuid NOT NULL,
  phone text,
  country_code text,
  reason text NOT NULL,
  provider_error_code text,
  provider_request_id text,
  provider_status integer,
  processor_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sms_item_quarantine_events TO authenticated;
GRANT ALL ON public.sms_item_quarantine_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_sms_quarantine_events_blast
  ON public.sms_item_quarantine_events (blast_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_quarantine_events_tenant
  ON public.sms_item_quarantine_events (tenant_id, created_at DESC);

ALTER TABLE public.sms_item_quarantine_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quarantine_events_tenant_read" ON public.sms_item_quarantine_events;
CREATE POLICY "quarantine_events_tenant_read"
  ON public.sms_item_quarantine_events
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT uca.tenant_id
      FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid()
    )
  );
