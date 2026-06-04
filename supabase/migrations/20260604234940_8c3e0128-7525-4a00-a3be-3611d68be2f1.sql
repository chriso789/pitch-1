ALTER TABLE public.ai_outreach_queue ADD COLUMN IF NOT EXISTS location_id uuid;
CREATE INDEX IF NOT EXISTS idx_ai_outreach_queue_tenant_location ON public.ai_outreach_queue(tenant_id, location_id);

-- Backfill location_id from contact
UPDATE public.ai_outreach_queue q
SET location_id = c.location_id
FROM public.contacts c
WHERE q.contact_id = c.id
  AND q.location_id IS NULL
  AND c.location_id IS NOT NULL;