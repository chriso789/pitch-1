CREATE TABLE IF NOT EXISTS public.labor_order_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid,
  tenant_id uuid,
  sent_by uuid,
  recipient_email text NOT NULL,
  recipient_name text,
  customer_name text,
  project_address text,
  resend_message_id text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0,
  last_opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_labor_order_emails_estimate ON public.labor_order_emails(estimate_id);
CREATE INDEX IF NOT EXISTS idx_labor_order_emails_tenant ON public.labor_order_emails(tenant_id);

ALTER TABLE public.labor_order_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view labor order emails"
  ON public.labor_order_emails FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Service role manages labor order emails"
  ON public.labor_order_emails FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER PUBLICATION supabase_realtime ADD TABLE public.labor_order_emails;
ALTER TABLE public.labor_order_emails REPLICA IDENTITY FULL;