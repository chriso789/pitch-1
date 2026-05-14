
CREATE TABLE IF NOT EXISTS public.change_order_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  change_order_id UUID NOT NULL REFERENCES public.change_orders(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  recipient_name TEXT,
  recipient_email TEXT NOT NULL,
  sent_by UUID,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signed_by_name TEXT,
  signed_by_email TEXT,
  signature_data_url TEXT,
  signature_ip TEXT,
  signature_user_agent TEXT,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '60 days'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_co_share_token ON public.change_order_share_links(token);
CREATE INDEX IF NOT EXISTS idx_co_share_co ON public.change_order_share_links(change_order_id);

ALTER TABLE public.change_order_share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view CO share links"
  ON public.change_order_share_links FOR SELECT
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Tenant members can create CO share links"
  ON public.change_order_share_links FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Tenant members can update CO share links"
  ON public.change_order_share_links FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
