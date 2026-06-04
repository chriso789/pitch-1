
ALTER TABLE public.dialer_campaigns ADD COLUMN IF NOT EXISTS location_id uuid;
ALTER TABLE public.ai_call_transcripts ADD COLUMN IF NOT EXISTS location_id uuid;
ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS location_id uuid;

CREATE INDEX IF NOT EXISTS idx_dialer_campaigns_tenant_location ON public.dialer_campaigns(tenant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_ai_call_transcripts_tenant_location ON public.ai_call_transcripts(tenant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_tenant_location ON public.call_transcripts(tenant_id, location_id);

NOTIFY pgrst, 'reload schema';
