
CREATE TABLE public.sms_blasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  list_id UUID REFERENCES public.dialer_lists(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  script TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'completed', 'cancelled')),
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  opted_out_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.sms_blasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view their blasts"
  ON public.sms_blasts FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant users can insert blasts"
  ON public.sms_blasts FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant users can update their blasts"
  ON public.sms_blasts FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE TABLE public.sms_blast_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blast_id UUID NOT NULL REFERENCES public.sms_blasts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  contact_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'opted_out', 'cancelled')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE
);

ALTER TABLE public.sms_blast_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view their blast items"
  ON public.sms_blast_items FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant users can insert blast items"
  ON public.sms_blast_items FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant users can update their blast items"
  ON public.sms_blast_items FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE INDEX idx_sms_blast_items_blast_id ON public.sms_blast_items(blast_id);
CREATE INDEX idx_sms_blast_items_status ON public.sms_blast_items(blast_id, status);
CREATE INDEX idx_sms_blasts_tenant ON public.sms_blasts(tenant_id, created_at DESC);
