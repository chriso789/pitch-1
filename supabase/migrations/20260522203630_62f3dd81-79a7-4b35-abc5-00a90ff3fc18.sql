
-- Cache for Telnyx phone line type lookups so we don't re-charge for the same number.
CREATE TABLE IF NOT EXISTS public.phone_line_types (
  phone TEXT PRIMARY KEY,
  line_type TEXT NOT NULL,         -- 'mobile' | 'landline' | 'voip' | 'unknown'
  carrier_name TEXT,
  raw JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_line_types ENABLE ROW LEVEL SECURITY;

-- Only service role (edge functions) writes; authenticated users may read.
CREATE POLICY "Authenticated can read phone line types"
  ON public.phone_line_types
  FOR SELECT
  TO authenticated
  USING (true);

-- Add an item status for landline skips + scrubbing audit field on contacts.
DO $$ BEGIN
  ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS scrubbed_landline_phones TEXT[] DEFAULT '{}';
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_sms_messages_tenant_outbound
  ON public.sms_messages (tenant_id, direction, created_at DESC);
