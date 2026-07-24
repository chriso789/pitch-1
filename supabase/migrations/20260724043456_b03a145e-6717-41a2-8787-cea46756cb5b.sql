
-- =====================================================================
-- QBO Accounting V2 — Slice 2a (retry with fixed SELECT INTO)
-- =====================================================================

ALTER TABLE public.project_scopes
  ADD COLUMN IF NOT EXISTS classification_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classification_review_reason text;

UPDATE public.project_scopes
   SET classification_review_required = true,
       classification_review_reason   = 'Slice 1 fallback classification — confirm trade, project type, and job type before mapping.'
 WHERE classification_source::text IN ('single_scope_fallback','lead_selection')
   AND classification_review_required = false;

-- QBO caches ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qbo_item_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  qbo_connection_id uuid NOT NULL REFERENCES public.qbo_connections(id) ON DELETE CASCADE,
  realm_id text NOT NULL,
  oauth_app_env text,
  qbo_id text NOT NULL,
  name text,
  fully_qualified_name text,
  item_type text,
  active boolean NOT NULL DEFAULT true,
  taxable boolean,
  income_account_id text,
  income_account_name text,
  expense_account_id text,
  sync_token text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qbo_connection_id, qbo_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_item_cache TO authenticated;
GRANT ALL ON public.qbo_item_cache TO service_role;
ALTER TABLE public.qbo_item_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qbo_item_cache_tenant ON public.qbo_item_cache;
CREATE POLICY qbo_item_cache_tenant ON public.qbo_item_cache
  FOR ALL USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE TABLE IF NOT EXISTS public.qbo_account_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  qbo_connection_id uuid NOT NULL REFERENCES public.qbo_connections(id) ON DELETE CASCADE,
  realm_id text NOT NULL, oauth_app_env text,
  qbo_id text NOT NULL, name text, fully_qualified_name text,
  account_type text, account_sub_type text, classification text,
  active boolean NOT NULL DEFAULT true, parent_id text, current_balance numeric,
  sync_token text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qbo_connection_id, qbo_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_account_cache TO authenticated;
GRANT ALL ON public.qbo_account_cache TO service_role;
ALTER TABLE public.qbo_account_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qbo_account_cache_tenant ON public.qbo_account_cache;
CREATE POLICY qbo_account_cache_tenant ON public.qbo_account_cache
  FOR ALL USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE TABLE IF NOT EXISTS public.qbo_class_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  qbo_connection_id uuid NOT NULL REFERENCES public.qbo_connections(id) ON DELETE CASCADE,
  realm_id text NOT NULL, oauth_app_env text,
  qbo_id text NOT NULL, name text, fully_qualified_name text,
  active boolean NOT NULL DEFAULT true, parent_id text,
  sync_token text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qbo_connection_id, qbo_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_class_cache TO authenticated;
GRANT ALL ON public.qbo_class_cache TO service_role;
ALTER TABLE public.qbo_class_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qbo_class_cache_tenant ON public.qbo_class_cache;
CREATE POLICY qbo_class_cache_tenant ON public.qbo_class_cache
  FOR ALL USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE TABLE IF NOT EXISTS public.qbo_department_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  qbo_connection_id uuid NOT NULL REFERENCES public.qbo_connections(id) ON DELETE CASCADE,
  realm_id text NOT NULL, oauth_app_env text,
  qbo_id text NOT NULL, name text, fully_qualified_name text,
  active boolean NOT NULL DEFAULT true, parent_id text,
  sync_token text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qbo_connection_id, qbo_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_department_cache TO authenticated;
GRANT ALL ON public.qbo_department_cache TO service_role;
ALTER TABLE public.qbo_department_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qbo_department_cache_tenant ON public.qbo_department_cache;
CREATE POLICY qbo_department_cache_tenant ON public.qbo_department_cache
  FOR ALL USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE TABLE IF NOT EXISTS public.qbo_tax_code_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  qbo_connection_id uuid NOT NULL REFERENCES public.qbo_connections(id) ON DELETE CASCADE,
  realm_id text NOT NULL, oauth_app_env text,
  qbo_id text NOT NULL, name text,
  active boolean NOT NULL DEFAULT true, taxable boolean,
  sync_token text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qbo_connection_id, qbo_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_tax_code_cache TO authenticated;
GRANT ALL ON public.qbo_tax_code_cache TO service_role;
ALTER TABLE public.qbo_tax_code_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qbo_tax_code_cache_tenant ON public.qbo_tax_code_cache;
CREATE POLICY qbo_tax_code_cache_tenant ON public.qbo_tax_code_cache
  FOR ALL USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE TABLE IF NOT EXISTS public.qbo_terms_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  qbo_connection_id uuid NOT NULL REFERENCES public.qbo_connections(id) ON DELETE CASCADE,
  realm_id text NOT NULL, oauth_app_env text,
  qbo_id text NOT NULL, name text,
  active boolean NOT NULL DEFAULT true,
  due_days integer, discount_days integer, discount_percent numeric,
  sync_token text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qbo_connection_id, qbo_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_terms_cache TO authenticated;
GRANT ALL ON public.qbo_terms_cache TO service_role;
ALTER TABLE public.qbo_terms_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qbo_terms_cache_tenant ON public.qbo_terms_cache;
CREATE POLICY qbo_terms_cache_tenant ON public.qbo_terms_cache
  FOR ALL USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- Mappings ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_scope_accounting_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  qbo_connection_id uuid NOT NULL REFERENCES public.qbo_connections(id) ON DELETE CASCADE,
  trade_id text NOT NULL,
  project_type_id text NOT NULL,
  job_type_id text,
  job_type_key text GENERATED ALWAYS AS (COALESCE(job_type_id, '__null__')) STORED,
  qbo_item_id text NOT NULL,
  qbo_item_name_snapshot text,
  qbo_item_type_snapshot text,
  qbo_income_account_id_snapshot text,
  qbo_income_account_name_snapshot text,
  qbo_class_id text, qbo_class_name_snapshot text,
  qbo_department_id text, qbo_department_name_snapshot text,
  qbo_tax_code_id text, qbo_tax_code_name_snapshot text,
  qbo_terms_id text, qbo_terms_name_snapshot text,
  default_allow_credit_card boolean NOT NULL DEFAULT true,
  default_allow_ach boolean NOT NULL DEFAULT true,
  invoice_template_key text,
  customer_memo_template text,
  active boolean NOT NULL DEFAULT true,
  validation_status text NOT NULL DEFAULT 'unvalidated'
    CHECK (validation_status IN (
      'unvalidated','valid','stale','missing_item','inactive_item',
      'wrong_item_type','missing_income_account','inactive_class',
      'inactive_department','invalid_tax_code','invalid_terms',
      'connection_mismatch','error'
    )),
  validation_error text,
  last_validated_at timestamptz,
  qbo_sync_token_snapshot text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_scope_mapping
  ON public.project_scope_accounting_mappings (
    tenant_id, qbo_connection_id, trade_id, project_type_id, job_type_key
  ) WHERE active = true AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scope_mapping_tenant_conn
  ON public.project_scope_accounting_mappings (tenant_id, qbo_connection_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_scope_accounting_mappings TO authenticated;
GRANT ALL ON public.project_scope_accounting_mappings TO service_role;
ALTER TABLE public.project_scope_accounting_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scope_mapping_tenant_r ON public.project_scope_accounting_mappings;
DROP POLICY IF EXISTS scope_mapping_tenant_w ON public.project_scope_accounting_mappings;
DROP POLICY IF EXISTS scope_mapping_tenant_u ON public.project_scope_accounting_mappings;
DROP POLICY IF EXISTS scope_mapping_tenant_d ON public.project_scope_accounting_mappings;
CREATE POLICY scope_mapping_tenant_r ON public.project_scope_accounting_mappings
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));
CREATE POLICY scope_mapping_tenant_w ON public.project_scope_accounting_mappings
  FOR INSERT WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));
CREATE POLICY scope_mapping_tenant_u ON public.project_scope_accounting_mappings
  FOR UPDATE USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));
CREATE POLICY scope_mapping_tenant_d ON public.project_scope_accounting_mappings
  FOR DELETE USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- Resolutions ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_scope_accounting_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  project_scope_id uuid NOT NULL REFERENCES public.project_scopes(id) ON DELETE CASCADE,
  accounting_snapshot_id uuid NOT NULL REFERENCES public.project_accounting_snapshots(id) ON DELETE CASCADE,
  qbo_connection_id uuid REFERENCES public.qbo_connections(id) ON DELETE SET NULL,
  mapping_id uuid REFERENCES public.project_scope_accounting_mappings(id) ON DELETE SET NULL,
  resolution_status text NOT NULL DEFAULT 'unresolved'
    CHECK (resolution_status IN (
      'unresolved','resolved','stale','invalid',
      'classification_review_required','connection_missing'
    )),
  resolution_reason text,
  resolved_at timestamptz,
  last_validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_scope_id, accounting_snapshot_id)
);
CREATE INDEX IF NOT EXISTS idx_scope_resolution_project ON public.project_scope_accounting_resolutions (project_id);
CREATE INDEX IF NOT EXISTS idx_scope_resolution_tenant ON public.project_scope_accounting_resolutions (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_scope_accounting_resolutions TO authenticated;
GRANT ALL ON public.project_scope_accounting_resolutions TO service_role;
ALTER TABLE public.project_scope_accounting_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scope_resolution_tenant ON public.project_scope_accounting_resolutions;
CREATE POLICY scope_resolution_tenant ON public.project_scope_accounting_resolutions
  FOR ALL USING (tenant_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- Audit events --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid,
  effective_tenant_id uuid,
  impersonation boolean NOT NULL DEFAULT false,
  qbo_connection_id uuid,
  project_id uuid,
  project_scope_id uuid,
  mapping_id uuid,
  intuit_tid text,
  correlation_id text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acct_audit_tenant_created ON public.accounting_audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acct_audit_project ON public.accounting_audit_events (project_id, created_at DESC);
GRANT SELECT, INSERT ON public.accounting_audit_events TO authenticated;
GRANT ALL ON public.accounting_audit_events TO service_role;
ALTER TABLE public.accounting_audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acct_audit_tenant_r ON public.accounting_audit_events;
DROP POLICY IF EXISTS acct_audit_tenant_w ON public.accounting_audit_events;
CREATE POLICY acct_audit_tenant_r ON public.accounting_audit_events
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));
CREATE POLICY acct_audit_tenant_w ON public.accounting_audit_events
  FOR INSERT WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE OR REPLACE FUNCTION public.accounting_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'accounting_audit_events is immutable'; END;
$$;
DROP TRIGGER IF EXISTS trg_acct_audit_no_update ON public.accounting_audit_events;
CREATE TRIGGER trg_acct_audit_no_update
  BEFORE UPDATE OR DELETE ON public.accounting_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.accounting_audit_immutable();

-- Resolver ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_project_accounting(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid;
  v_old_readiness text;
  v_snapshot_id uuid;
  v_scope record;
  v_conn_id uuid;
  v_mapping record;
  v_new_readiness text;
  v_active_scope_count int := 0;
  v_pending_class_count int := 0;
  v_unmapped_count int := 0;
  v_status text;
  v_reason text;
  v_scope_details jsonb := '[]'::jsonb;
BEGIN
  SELECT p.tenant_id, p.accounting_readiness::text
    INTO v_tenant, v_old_readiness
    FROM public.projects p
   WHERE p.id = p_project_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'project not found: %', p_project_id;
  END IF;

  SELECT s.id INTO v_snapshot_id
    FROM public.project_accounting_snapshots s
   WHERE s.project_id = p_project_id AND s.is_current = true
   LIMIT 1;

  IF v_snapshot_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_current_snapshot');
  END IF;

  SELECT id INTO v_conn_id
    FROM public.qbo_connections
   WHERE tenant_id = v_tenant AND is_active = true AND disconnected_at IS NULL
   ORDER BY connected_at DESC NULLS LAST
   LIMIT 1;

  FOR v_scope IN
    SELECT * FROM public.project_scopes
     WHERE project_id = p_project_id AND status = 'active'
     ORDER BY is_primary DESC, created_at ASC
  LOOP
    v_active_scope_count := v_active_scope_count + 1;
    v_mapping := NULL;
    v_status  := 'unresolved';
    v_reason  := NULL;

    IF v_scope.trade_id IS NULL
       OR v_scope.project_type_id IS NULL
       OR v_scope.classification_review_required = true THEN
      v_status := 'classification_review_required';
      v_reason := COALESCE(
        v_scope.classification_review_reason,
        CASE
          WHEN v_scope.trade_id IS NULL THEN 'Trade is not classified'
          WHEN v_scope.project_type_id IS NULL THEN 'Project type is not classified'
          ELSE 'Scope classification requires human review'
        END
      );
      v_pending_class_count := v_pending_class_count + 1;
    ELSIF v_conn_id IS NULL THEN
      v_status := 'connection_missing';
      v_reason := 'Tenant has no active QuickBooks connection';
    ELSE
      SELECT *
        INTO v_mapping
        FROM public.project_scope_accounting_mappings m
       WHERE m.tenant_id = v_tenant
         AND m.qbo_connection_id = v_conn_id
         AND m.trade_id = v_scope.trade_id
         AND m.project_type_id = v_scope.project_type_id
         AND m.active = true
         AND m.archived_at IS NULL
         AND (
           (v_scope.job_type_id IS NOT NULL AND m.job_type_id = v_scope.job_type_id)
           OR m.job_type_id IS NULL
         )
       ORDER BY (m.job_type_id IS NOT NULL) DESC, m.updated_at DESC
       LIMIT 1;

      IF v_mapping.id IS NULL THEN
        v_status := 'unresolved';
        v_reason := 'No mapping found for trade + project type' ||
                    CASE WHEN v_scope.job_type_id IS NOT NULL THEN ' (+ job type)' ELSE '' END;
        v_unmapped_count := v_unmapped_count + 1;
      ELSIF v_mapping.validation_status = 'valid' THEN
        v_status := 'resolved';
      ELSIF v_mapping.validation_status = 'unvalidated' THEN
        v_status := 'invalid';
        v_reason := 'Mapping exists but has not been validated against QuickBooks yet';
        v_unmapped_count := v_unmapped_count + 1;
      ELSIF v_mapping.validation_status = 'stale' THEN
        v_status := 'stale';
        v_reason := COALESCE(v_mapping.validation_error, 'Mapping is stale — QuickBooks catalog has changed');
        v_unmapped_count := v_unmapped_count + 1;
      ELSE
        v_status := 'invalid';
        v_reason := COALESCE(v_mapping.validation_error, 'Mapping is invalid (' || v_mapping.validation_status || ')');
        v_unmapped_count := v_unmapped_count + 1;
      END IF;
    END IF;

    INSERT INTO public.project_scope_accounting_resolutions AS r (
      tenant_id, project_id, project_scope_id, accounting_snapshot_id,
      qbo_connection_id, mapping_id, resolution_status, resolution_reason,
      resolved_at, last_validated_at, updated_at
    ) VALUES (
      v_tenant, p_project_id, v_scope.id, v_snapshot_id,
      v_conn_id, v_mapping.id, v_status, v_reason,
      CASE WHEN v_status = 'resolved' THEN now() ELSE NULL END,
      CASE WHEN v_status = 'resolved' THEN now() ELSE NULL END,
      now()
    )
    ON CONFLICT (project_scope_id, accounting_snapshot_id) DO UPDATE
      SET qbo_connection_id = EXCLUDED.qbo_connection_id,
          mapping_id        = EXCLUDED.mapping_id,
          resolution_status = EXCLUDED.resolution_status,
          resolution_reason = EXCLUDED.resolution_reason,
          resolved_at       = CASE WHEN EXCLUDED.resolution_status = 'resolved' THEN COALESCE(r.resolved_at, now()) ELSE NULL END,
          last_validated_at = CASE WHEN EXCLUDED.resolution_status = 'resolved' THEN now() ELSE r.last_validated_at END,
          updated_at        = now();

    v_scope_details := v_scope_details || jsonb_build_object(
      'scope_id', v_scope.id,
      'trade', v_scope.trade_name_snapshot,
      'status', v_status,
      'reason', v_reason,
      'mapping_id', v_mapping.id
    );
  END LOOP;

  IF v_active_scope_count = 0 OR v_pending_class_count > 0 THEN
    v_new_readiness := 'pending_classification';
  ELSIF v_conn_id IS NULL THEN
    v_new_readiness := 'qbo_not_connected';
  ELSIF v_unmapped_count > 0 THEN
    v_new_readiness := 'needs_mapping';
  ELSE
    v_new_readiness := 'qbo_sync_pending';
  END IF;

  UPDATE public.projects
     SET accounting_readiness = v_new_readiness::accounting_readiness_state,
         updated_at = now()
   WHERE id = p_project_id;

  UPDATE public.project_accounting_snapshots
     SET accounting_readiness = v_new_readiness::accounting_readiness_state
   WHERE id = v_snapshot_id;

  IF v_old_readiness IS DISTINCT FROM v_new_readiness THEN
    INSERT INTO public.accounting_audit_events (
      tenant_id, event_type, effective_tenant_id, project_id, qbo_connection_id,
      old_value, new_value, metadata
    ) VALUES (
      v_tenant, 'project_accounting_readiness_changed', v_tenant, p_project_id, v_conn_id,
      jsonb_build_object('accounting_readiness', v_old_readiness),
      jsonb_build_object('accounting_readiness', v_new_readiness),
      jsonb_build_object(
        'active_scopes', v_active_scope_count,
        'pending_classification', v_pending_class_count,
        'unmapped', v_unmapped_count
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', p_project_id,
    'snapshot_id', v_snapshot_id,
    'active_scopes', v_active_scope_count,
    'pending_classification', v_pending_class_count,
    'unmapped', v_unmapped_count,
    'qbo_connection_id', v_conn_id,
    'old_readiness', v_old_readiness,
    'new_readiness', v_new_readiness,
    'scopes', v_scope_details
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_project_accounting(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_project_accounting(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_scope_mapping_touch ON public.project_scope_accounting_mappings;
CREATE TRIGGER trg_scope_mapping_touch
  BEFORE UPDATE ON public.project_scope_accounting_mappings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst, 'reload schema';
