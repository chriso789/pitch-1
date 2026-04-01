
CREATE TABLE public.ten_dlc_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  brand_id TEXT,
  brand_status TEXT DEFAULT 'not_started',
  brand_payload JSONB DEFAULT '{}',
  campaign_id TEXT,
  campaign_status TEXT DEFAULT 'not_started',
  campaign_payload JSONB DEFAULT '{}',
  assigned_numbers TEXT[] DEFAULT '{}',
  telnyx_brand_response JSONB,
  telnyx_campaign_response JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

ALTER TABLE public.ten_dlc_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view own tenant 10DLC registrations"
  ON public.ten_dlc_registrations FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Authenticated users can insert own tenant 10DLC registrations"
  ON public.ten_dlc_registrations FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Authenticated users can update own tenant 10DLC registrations"
  ON public.ten_dlc_registrations FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
