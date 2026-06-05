-- =====================================================================
-- supplier_pricing_runs
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.supplier_pricing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplier text NOT NULL,
  source_context text NOT NULL CHECK (source_context IN ('template','estimate','project','order')),
  source_id uuid NULL,
  environment text NULL,
  account_number text NULL,
  ship_to_number text NULL,
  branch_number text NULL,
  job_account_number text NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','partial','cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  error_summary text NULL,
  created_by uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT, INSERT, UPDATE ON public.supplier_pricing_runs TO authenticated;
GRANT ALL ON public.supplier_pricing_runs TO service_role;

ALTER TABLE public.supplier_pricing_runs ENABLE ROW LEVEL SECURITY;

-- Tenant users: read their own tenant's runs
CREATE POLICY "supplier_pricing_runs_select_tenant"
  ON public.supplier_pricing_runs
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Tenant users: insert runs scoped to their own tenant (created_by must be self)
CREATE POLICY "supplier_pricing_runs_insert_tenant"
  ON public.supplier_pricing_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

-- Tenant users: update only their own runs (e.g. mark completed/failed from UI)
CREATE POLICY "supplier_pricing_runs_update_own"
  ON public.supplier_pricing_runs
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND created_by = auth.uid()
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND created_by = auth.uid()
  );

-- Service role: full access (edge functions write run status and completion)
CREATE POLICY "supplier_pricing_runs_service_role_all"
  ON public.supplier_pricing_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_supplier_pricing_runs_tenant_supplier_started
  ON public.supplier_pricing_runs (tenant_id, supplier, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_pricing_runs_tenant_source
  ON public.supplier_pricing_runs (tenant_id, source_context, source_id);

-- =====================================================================
-- supplier_price_history (append-only)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.supplier_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pricing_run_id uuid NULL REFERENCES public.supplier_pricing_runs(id) ON DELETE SET NULL,
  supplier text NOT NULL,
  template_id uuid NULL,
  template_item_id uuid NULL,
  estimate_id uuid NULL,
  estimate_line_item_id uuid NULL,
  purchase_order_id uuid NULL,
  purchase_order_item_id uuid NULL,
  supplier_item_number text NULL,
  supplier_item_description text NULL,
  uom text NULL,
  quantity numeric NULL,
  unit_price numeric NULL,
  extended_price numeric NULL,
  availability text NULL,
  account_number text NULL,
  ship_to_number text NULL,
  branch_number text NULL,
  job_account_number text NULL,
  price_source text NULL,
  raw_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','partial','unavailable','override')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);

-- Append-only: tenant users may SELECT only. No INSERT/UPDATE/DELETE grant.
GRANT SELECT ON public.supplier_price_history TO authenticated;
GRANT ALL ON public.supplier_price_history TO service_role;

ALTER TABLE public.supplier_price_history ENABLE ROW LEVEL SECURITY;

-- Tenant users: read their own tenant's price history
CREATE POLICY "supplier_price_history_select_tenant"
  ON public.supplier_price_history
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Service role: full access (edge functions append history rows)
CREATE POLICY "supplier_price_history_service_role_all"
  ON public.supplier_price_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Explicitly NO insert/update/delete policy for authenticated:
-- append-only from server-side context with resolved tenant_id only.

CREATE INDEX IF NOT EXISTS idx_supplier_price_history_tenant_supplier_checked
  ON public.supplier_price_history (tenant_id, supplier, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_price_history_tenant_item
  ON public.supplier_price_history (tenant_id, supplier_item_number);

CREATE INDEX IF NOT EXISTS idx_supplier_price_history_tenant_template_item
  ON public.supplier_price_history (tenant_id, template_item_id, supplier, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_price_history_tenant_estimate_line
  ON public.supplier_price_history (tenant_id, estimate_line_item_id, supplier, checked_at DESC);

-- =====================================================================
-- Reload PostgREST schema cache
-- =====================================================================
NOTIFY pgrst, 'reload schema';