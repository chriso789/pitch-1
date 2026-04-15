
-- SRS Connection credentials per tenant (encrypted via vault recommended)
CREATE TABLE public.srs_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  customer_code TEXT,
  client_id TEXT,
  client_secret TEXT,
  connection_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('connected', 'disconnected', 'error', 'validating')),
  last_validated_at TIMESTAMPTZ,
  last_error TEXT,
  job_account_number INTEGER,
  default_branch_code TEXT,
  valid_indicator BOOLEAN DEFAULT false,
  environment TEXT NOT NULL DEFAULT 'staging' CHECK (environment IN ('staging', 'production')),
  access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id)
);

ALTER TABLE public.srs_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant SRS connection"
  ON public.srs_connections FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert their tenant SRS connection"
  ON public.srs_connections FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid()));

CREATE POLICY "Users can update their tenant SRS connection"
  ON public.srs_connections FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid()));

-- Cached SRS branch locations
CREATE TABLE public.srs_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  branch_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  phone TEXT,
  shipping_methods JSONB DEFAULT '[]',
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, branch_code)
);

ALTER TABLE public.srs_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant SRS branches"
  ON public.srs_branches FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their tenant SRS branches"
  ON public.srs_branches FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid()));

-- SRS Material Orders
CREATE TABLE public.srs_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  order_number TEXT,
  srs_order_id TEXT,
  srs_transaction_id TEXT,
  branch_code TEXT NOT NULL,
  branch_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'error')),
  total_amount DECIMAL(12,2) DEFAULT 0,
  delivery_method TEXT CHECK (delivery_method IN ('pickup', 'delivery')),
  delivery_date DATE,
  delivery_address TEXT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  estimate_id UUID REFERENCES estimates(id) ON DELETE SET NULL,
  submitted_by UUID REFERENCES auth.users(id),
  submitted_at TIMESTAMPTZ,
  notes TEXT,
  srs_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.srs_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant SRS orders"
  ON public.srs_orders FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid()));

CREATE POLICY "Users can create their tenant SRS orders"
  ON public.srs_orders FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid()));

CREATE POLICY "Users can update their tenant SRS orders"
  ON public.srs_orders FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid()));

-- SRS Order Line Items
CREATE TABLE public.srs_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES srs_orders(id) ON DELETE CASCADE,
  srs_product_id INTEGER,
  product_name TEXT NOT NULL,
  product_description TEXT,
  quantity DECIMAL(10,2) NOT NULL,
  uom TEXT NOT NULL DEFAULT 'EA',
  unit_price DECIMAL(10,2),
  total_price DECIMAL(10,2),
  in_stock BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.srs_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view SRS order items via order"
  ON public.srs_order_items FOR SELECT
  TO authenticated
  USING (order_id IN (SELECT id FROM srs_orders WHERE tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid())));

CREATE POLICY "Users can manage SRS order items via order"
  ON public.srs_order_items FOR ALL
  TO authenticated
  USING (order_id IN (SELECT id FROM srs_orders WHERE tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid())));

-- Order Status History (webhook-driven)
CREATE TABLE public.srs_order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES srs_orders(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  status_message TEXT,
  raw_webhook_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.srs_order_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view SRS order status history"
  ON public.srs_order_status_history FOR SELECT
  TO authenticated
  USING (order_id IN (SELECT id FROM srs_orders WHERE tenant_id IN (SELECT tenant_id::text FROM user_company_access WHERE user_id = auth.uid())));

-- Triggers for updated_at
CREATE TRIGGER update_srs_connections_updated_at
  BEFORE UPDATE ON public.srs_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_srs_orders_updated_at
  BEFORE UPDATE ON public.srs_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for performance
CREATE INDEX idx_srs_orders_tenant_status ON public.srs_orders(tenant_id, status);
CREATE INDEX idx_srs_orders_project ON public.srs_orders(project_id);
CREATE INDEX idx_srs_order_items_order ON public.srs_order_items(order_id);
