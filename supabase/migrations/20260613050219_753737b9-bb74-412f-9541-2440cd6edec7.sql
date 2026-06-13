
-- 1) qxo_connections
ALTER TABLE public.qxo_connections
  ADD COLUMN IF NOT EXISTS authorized_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS authorization_method text DEFAULT 'api_key',
  ADD COLUMN IF NOT EXISTS authorization_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS scopes text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

UPDATE public.qxo_connections
SET
  authorization_status = 'active',
  scopes = ARRAY['pricing','catalog','order_submit','order_status','invoice_read','delivery_tracking'],
  connected_at = COALESCE(connected_at, created_at),
  last_verified_at = COALESCE(last_verified_at, last_validated_at, updated_at)
WHERE connection_status = 'connected'
  AND (authorization_status IS NULL OR authorization_status = 'pending');

CREATE INDEX IF NOT EXISTS idx_qxo_connections_tenant_status
  ON public.qxo_connections (tenant_id, authorization_status, connection_status);

-- 2) supplier_audit_log
CREATE TABLE IF NOT EXISTS public.supplier_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  supplier text NOT NULL,
  supplier_account_id text,
  action text NOT NULL,
  result text NOT NULL,
  request_id text,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.supplier_audit_log TO service_role;
GRANT SELECT ON public.supplier_audit_log TO authenticated;
ALTER TABLE public.supplier_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant admins can read own audit rows" ON public.supplier_audit_log;
CREATE POLICY "Tenant admins can read own audit rows"
  ON public.supplier_audit_log
  FOR SELECT
  TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'master'::public.app_role)
      OR public.has_role(auth.uid(), 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'office_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'corporate'::public.app_role)
    )
    AND tenant_id IN (
      SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_supplier_audit_tenant_created
  ON public.supplier_audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_audit_supplier_action
  ON public.supplier_audit_log (supplier, action, created_at DESC);

-- 3) supplier_idempotency_keys
CREATE TABLE IF NOT EXISTS public.supplier_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplier text NOT NULL,
  action text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text,
  response_json jsonb,
  status text NOT NULL DEFAULT 'started',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, supplier, action, idempotency_key)
);
GRANT ALL ON public.supplier_idempotency_keys TO service_role;
ALTER TABLE public.supplier_idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_supplier_idem_tenant_created
  ON public.supplier_idempotency_keys (tenant_id, created_at DESC);

-- 4) supplier_rate_limits
CREATE TABLE IF NOT EXISTS public.supplier_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  supplier text NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, supplier, action, window_start)
);
GRANT ALL ON public.supplier_rate_limits TO service_role;
ALTER TABLE public.supplier_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_supplier_rate_lookup
  ON public.supplier_rate_limits (tenant_id, supplier, action, window_start DESC);
