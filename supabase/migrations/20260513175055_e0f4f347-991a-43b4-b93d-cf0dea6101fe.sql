
CREATE TABLE public.qxo_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  beacon_order_id text NOT NULL,
  account_id text,
  po_number text,
  customer_uuid text,
  job_name text,
  job_number text,
  status_code text,
  status_value text,
  on_hold boolean DEFAULT false,
  total numeric,
  sub_total numeric,
  tax numeric,
  currency text DEFAULT 'USD',
  order_placed_date timestamptz,
  invoiced_date timestamptz,
  payment_status text,
  selling_branch text,
  shipping_branch text,
  shipping_method text,
  ship_address jsonb,
  raw_payload jsonb,
  last_synced_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, beacon_order_id)
);
CREATE INDEX idx_qxo_orders_tenant ON public.qxo_orders (tenant_id, order_placed_date DESC);

ALTER TABLE public.qxo_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members read qxo_orders"
  ON public.qxo_orders FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.can_view_all_tenants());
CREATE POLICY "Service role manages qxo_orders"
  ON public.qxo_orders FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_qxo_orders_updated_at
  BEFORE UPDATE ON public.qxo_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.qxo_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  beacon_quote_id text NOT NULL,
  mincron_id text,
  account_id text,
  account_name text,
  status text,
  status_description text,
  job_name text,
  job_number text,
  work_type text,
  total numeric,
  sub_total numeric,
  tax numeric,
  expires date,
  creation_date date,
  quote_notes text,
  quote_items jsonb,
  raw_payload jsonb,
  last_synced_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, beacon_quote_id)
);
CREATE INDEX idx_qxo_quotes_tenant ON public.qxo_quotes (tenant_id, creation_date DESC);

ALTER TABLE public.qxo_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members read qxo_quotes"
  ON public.qxo_quotes FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.can_view_all_tenants());
CREATE POLICY "Service role manages qxo_quotes"
  ON public.qxo_quotes FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_qxo_quotes_updated_at
  BEFORE UPDATE ON public.qxo_quotes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS beacon_order_id text,
  ADD COLUMN IF NOT EXISTS beacon_message_code text,
  ADD COLUMN IF NOT EXISTS beacon_message text,
  ADD COLUMN IF NOT EXISTS beacon_uuid uuid;

ALTER TABLE public.qxo_invoices
  ADD COLUMN IF NOT EXISTS company integer,
  ADD COLUMN IF NOT EXISTS branch_number integer,
  ADD COLUMN IF NOT EXISTS sales numeric,
  ADD COLUMN IF NOT EXISTS other_charges numeric,
  ADD COLUMN IF NOT EXISTS sales_plus_other_charges numeric,
  ADD COLUMN IF NOT EXISTS mincron_invoice_pdf_url text;
