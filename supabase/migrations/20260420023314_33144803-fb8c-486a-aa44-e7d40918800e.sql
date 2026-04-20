-- ============================================
-- PHASE 1: AUTOMATION ENGINE FOUNDATION
-- ============================================

-- 1. event_types lookup
CREATE TABLE public.event_types (
  key text PRIMARY KEY,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_types readable by authenticated"
  ON public.event_types FOR SELECT
  TO authenticated
  USING (true);

-- 2. domain_events
CREATE TABLE public.domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL REFERENCES public.event_types(key),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  parent_entity_type text,
  parent_entity_id uuid,
  event_source text NOT NULL DEFAULT 'system',
  caused_by_user_id uuid,
  caused_by_automation_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX domain_events_company_dedupe_idx
  ON public.domain_events(company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX domain_events_company_type_idx
  ON public.domain_events(company_id, event_type, occurred_at DESC);

CREATE INDEX domain_events_entity_idx
  ON public.domain_events(company_id, entity_type, entity_id, occurred_at DESC);

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "domain_events tenant select"
  ON public.domain_events FOR SELECT
  TO authenticated
  USING (
    company_id IN (SELECT public.get_user_tenant_ids())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "domain_events tenant insert"
  ON public.domain_events FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "domain_events tenant update"
  ON public.domain_events FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "domain_events tenant delete"
  ON public.domain_events FOR DELETE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()));

-- 3. automation_rules_v2
CREATE TABLE public.automation_rules_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  trigger_event text NOT NULL REFERENCES public.event_types(key),
  trigger_scope text NOT NULL DEFAULT 'entity',
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  cooldown_seconds integer NOT NULL DEFAULT 0,
  max_runs_per_entity_per_day integer,
  stop_processing_on_match boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX automation_rules_v2_company_trigger_idx
  ON public.automation_rules_v2(company_id, trigger_event, is_active);

ALTER TABLE public.automation_rules_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_v2 tenant select"
  ON public.automation_rules_v2 FOR SELECT
  TO authenticated
  USING (
    company_id IN (SELECT public.get_user_tenant_ids())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "ar_v2 tenant insert"
  ON public.automation_rules_v2 FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "ar_v2 tenant update"
  ON public.automation_rules_v2 FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "ar_v2 tenant delete"
  ON public.automation_rules_v2 FOR DELETE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()));

-- 4. automation_runs
CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  automation_rule_id uuid NOT NULL REFERENCES public.automation_rules_v2(id) ON DELETE CASCADE,
  domain_event_id uuid NOT NULL REFERENCES public.domain_events(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  skip_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX automation_runs_unique_once_idx
  ON public.automation_runs(automation_rule_id, domain_event_id);

CREATE INDEX automation_runs_company_status_idx
  ON public.automation_runs(company_id, status, created_at DESC);

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "automation_runs tenant select"
  ON public.automation_runs FOR SELECT
  TO authenticated
  USING (
    company_id IN (SELECT public.get_user_tenant_ids())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "automation_runs tenant insert"
  ON public.automation_runs FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "automation_runs tenant update"
  ON public.automation_runs FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "automation_runs tenant delete"
  ON public.automation_runs FOR DELETE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()));

-- 5. automation_action_runs
CREATE TABLE public.automation_action_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_run_id uuid NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  action_index integer NOT NULL,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX automation_action_runs_run_idx
  ON public.automation_action_runs(automation_run_id, action_index);

ALTER TABLE public.automation_action_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aar tenant select"
  ON public.automation_action_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.automation_runs r
      WHERE r.id = automation_action_runs.automation_run_id
      AND (
        r.company_id IN (SELECT public.get_user_tenant_ids())
        OR public.has_role(auth.uid(), 'master'::app_role)
      )
    )
  );

CREATE POLICY "aar tenant insert"
  ON public.automation_action_runs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.automation_runs r
      WHERE r.id = automation_action_runs.automation_run_id
      AND r.company_id IN (SELECT public.get_user_tenant_ids())
    )
  );

CREATE POLICY "aar tenant update"
  ON public.automation_action_runs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.automation_runs r
      WHERE r.id = automation_action_runs.automation_run_id
      AND r.company_id IN (SELECT public.get_user_tenant_ids())
    )
  );

CREATE POLICY "aar tenant delete"
  ON public.automation_action_runs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.automation_runs r
      WHERE r.id = automation_action_runs.automation_run_id
      AND r.company_id IN (SELECT public.get_user_tenant_ids())
    )
  );

-- 6. smart_tag_cache
CREATE TABLE public.smart_tag_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  tag_key text NOT NULL,
  tag_value jsonb,
  rendered_text text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE UNIQUE INDEX smart_tag_cache_unique_idx
  ON public.smart_tag_cache(company_id, entity_type, entity_id, tag_key);

ALTER TABLE public.smart_tag_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stc tenant select"
  ON public.smart_tag_cache FOR SELECT
  TO authenticated
  USING (
    company_id IN (SELECT public.get_user_tenant_ids())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "stc tenant insert"
  ON public.smart_tag_cache FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "stc tenant update"
  ON public.smart_tag_cache FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "stc tenant delete"
  ON public.smart_tag_cache FOR DELETE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()));

-- 7. ai_context_profiles
CREATE TABLE public.ai_context_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope_type text NOT NULL,
  scope_id uuid NOT NULL,
  summary_short text,
  summary_long text,
  structured_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  recent_activity jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_loops jsonb NOT NULL DEFAULT '[]'::jsonb,
  financial_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  production_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  communication_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  documents_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_event_at timestamptz,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_context_profiles_scope_idx
  ON public.ai_context_profiles(company_id, scope_type, scope_id);

ALTER TABLE public.ai_context_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acp tenant select"
  ON public.ai_context_profiles FOR SELECT
  TO authenticated
  USING (
    company_id IN (SELECT public.get_user_tenant_ids())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "acp tenant insert"
  ON public.ai_context_profiles FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "acp tenant update"
  ON public.ai_context_profiles FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "acp tenant delete"
  ON public.ai_context_profiles FOR DELETE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()));

-- 8. ai_context_refresh_queue
CREATE TABLE public.ai_context_refresh_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope_type text NOT NULL,
  scope_id uuid NOT NULL,
  reason text,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_context_refresh_queue_status_idx
  ON public.ai_context_refresh_queue(company_id, status, priority);

ALTER TABLE public.ai_context_refresh_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acrq tenant select"
  ON public.ai_context_refresh_queue FOR SELECT
  TO authenticated
  USING (
    company_id IN (SELECT public.get_user_tenant_ids())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "acrq tenant insert"
  ON public.ai_context_refresh_queue FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "acrq tenant update"
  ON public.ai_context_refresh_queue FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "acrq tenant delete"
  ON public.ai_context_refresh_queue FOR DELETE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()));

-- 9. automation_generated_records
CREATE TABLE public.automation_generated_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  automation_run_id uuid NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  record_type text NOT NULL,
  record_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agr_company_record_idx
  ON public.automation_generated_records(company_id, record_type, record_id);

ALTER TABLE public.automation_generated_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agr tenant select"
  ON public.automation_generated_records FOR SELECT
  TO authenticated
  USING (
    company_id IN (SELECT public.get_user_tenant_ids())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "agr tenant insert"
  ON public.automation_generated_records FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "agr tenant update"
  ON public.automation_generated_records FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "agr tenant delete"
  ON public.automation_generated_records FOR DELETE
  TO authenticated
  USING (company_id IN (SELECT public.get_user_tenant_ids()));

-- updated_at trigger for automation_rules_v2
CREATE TRIGGER set_ar_v2_updated_at
  BEFORE UPDATE ON public.automation_rules_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_acrq_updated_at
  BEFORE UPDATE ON public.ai_context_refresh_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed canonical event_types
INSERT INTO public.event_types (key, description) VALUES
  ('lead.created', 'A new lead was created'),
  ('lead.assigned', 'A lead was assigned to a rep'),
  ('lead.status_changed', 'Lead status changed'),
  ('job.created', 'A job was created'),
  ('job.status_changed', 'Job status changed'),
  ('job.complete', 'Job marked complete'),
  ('job.closed', 'Job closed'),
  ('estimate.sent', 'Estimate sent to customer'),
  ('estimate.approved', 'Estimate approved by customer'),
  ('estimate.rejected', 'Estimate rejected by customer'),
  ('contract.signed', 'Contract signed'),
  ('permit.submitted', 'Permit submitted to city'),
  ('permit.approved', 'Permit approved'),
  ('materials.ordered', 'Materials ordered'),
  ('materials.delivered', 'Materials delivered'),
  ('invoice.created', 'Invoice created'),
  ('invoice.overdue', 'Invoice overdue'),
  ('payment.received', 'Payment received'),
  ('inspection.scheduled', 'Inspection scheduled'),
  ('inspection.failed', 'Inspection failed'),
  ('inspection.passed', 'Inspection passed'),
  ('communication.inbound_sms', 'Inbound SMS received'),
  ('communication.outbound_sms', 'Outbound SMS sent'),
  ('communication.inbound_email', 'Inbound email received'),
  ('communication.outbound_email', 'Outbound email sent'),
  ('communication.call_completed', 'Phone call completed'),
  ('document.uploaded', 'Document uploaded'),
  ('task.overdue', 'Task became overdue'),
  ('note.added', 'Note added'),
  ('ai.summary_requested', 'AI summary requested')
ON CONFLICT (key) DO NOTHING;