
CREATE TABLE IF NOT EXISTS public.qbo_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  connection_id uuid,
  realm_id text,
  oauth_app_env text,
  action text NOT NULL,
  endpoint text,
  method text,
  http_status integer,
  intuit_tid text,
  success boolean NOT NULL DEFAULT false,
  error_code text,
  error_message text,
  duration_ms integer,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.qbo_api_logs TO authenticated;
GRANT ALL ON public.qbo_api_logs TO service_role;

ALTER TABLE public.qbo_api_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qbo_api_logs_master_all" ON public.qbo_api_logs;
CREATE POLICY "qbo_api_logs_master_all"
  ON public.qbo_api_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::public.app_role));

DROP POLICY IF EXISTS "qbo_api_logs_tenant_admins_read" ON public.qbo_api_logs;
CREATE POLICY "qbo_api_logs_tenant_admins_read"
  ON public.qbo_api_logs
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.tenant_id = qbo_api_logs.tenant_id
        AND ur.role IN ('owner'::public.app_role, 'office_admin'::public.app_role, 'corporate'::public.app_role)
    )
  );

CREATE INDEX IF NOT EXISTS qbo_api_logs_tenant_id_idx     ON public.qbo_api_logs(tenant_id);
CREATE INDEX IF NOT EXISTS qbo_api_logs_realm_id_idx      ON public.qbo_api_logs(realm_id);
CREATE INDEX IF NOT EXISTS qbo_api_logs_intuit_tid_idx    ON public.qbo_api_logs(intuit_tid);
CREATE INDEX IF NOT EXISTS qbo_api_logs_action_idx        ON public.qbo_api_logs(action);
CREATE INDEX IF NOT EXISTS qbo_api_logs_created_at_idx    ON public.qbo_api_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS qbo_api_logs_success_idx       ON public.qbo_api_logs(success);

COMMENT ON TABLE public.qbo_api_logs IS 'Per-call audit of QuickBooks Online API requests for Intuit production-review evidence. Never stores access_token or refresh_token.';

CREATE TABLE IF NOT EXISTS public.qbo_connection_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  connection_id uuid,
  realm_id text,
  oauth_app_env text NOT NULL,
  test_type text NOT NULL
    CHECK (test_type IN (
      'sandbox_connect',
      'sandbox_disconnect',
      'sandbox_reconnect',
      'token_refresh',
      'validation_error',
      'invalid_grant',
      'webhook_signature'
    )),
  status text NOT NULL
    CHECK (status IN ('passed','failed','skipped')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.qbo_connection_tests TO authenticated;
GRANT ALL ON public.qbo_connection_tests TO service_role;

ALTER TABLE public.qbo_connection_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qbo_connection_tests_master_all" ON public.qbo_connection_tests;
CREATE POLICY "qbo_connection_tests_master_all"
  ON public.qbo_connection_tests
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::public.app_role));

DROP POLICY IF EXISTS "qbo_connection_tests_tenant_read" ON public.qbo_connection_tests;
CREATE POLICY "qbo_connection_tests_tenant_read"
  ON public.qbo_connection_tests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.tenant_id = qbo_connection_tests.tenant_id
        AND ur.role IN ('owner'::public.app_role, 'office_admin'::public.app_role, 'corporate'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "qbo_connection_tests_tenant_insert" ON public.qbo_connection_tests;
CREATE POLICY "qbo_connection_tests_tenant_insert"
  ON public.qbo_connection_tests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.tenant_id = qbo_connection_tests.tenant_id
        AND ur.role IN ('owner'::public.app_role, 'office_admin'::public.app_role, 'corporate'::public.app_role)
    )
  );

CREATE INDEX IF NOT EXISTS qbo_connection_tests_tenant_id_idx  ON public.qbo_connection_tests(tenant_id);
CREATE INDEX IF NOT EXISTS qbo_connection_tests_test_type_idx  ON public.qbo_connection_tests(test_type);
CREATE INDEX IF NOT EXISTS qbo_connection_tests_created_at_idx ON public.qbo_connection_tests(created_at DESC);

COMMENT ON TABLE public.qbo_connection_tests IS 'Records of sandbox/non-production QBO tests (connect/disconnect/reconnect, refresh, validation error, invalid_grant, webhook signature) used as Intuit review evidence.';

NOTIFY pgrst, 'reload schema';
