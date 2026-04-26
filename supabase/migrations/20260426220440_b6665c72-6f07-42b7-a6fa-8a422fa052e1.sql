-- Geometry-first AI measurement guardrails (per build plan)
-- Adds customer-safety flags and audit columns. Additive; non-destructive.

ALTER TABLE public.ai_measurement_results
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS geometry_quality_score numeric,
  ADD COLUMN IF NOT EXISTS measurement_quality_score numeric,
  ADD COLUMN IF NOT EXISTS qa_breakdown jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS geometry_source text,
  ADD COLUMN IF NOT EXISTS edge_source text,
  ADD COLUMN IF NOT EXISTS publishable_at timestamptz;

ALTER TABLE public.ai_measurement_diagrams
  ADD COLUMN IF NOT EXISTS customer_safe boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS entrypoint text NOT NULL DEFAULT 'start-ai-measurement',
  ADD COLUMN IF NOT EXISTS source_context jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS report_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ai_measurement_results_publishable
  ON public.ai_measurement_results (report_blocked, needs_review);

CREATE INDEX IF NOT EXISTS idx_ai_measurement_diagrams_customer_safe
  ON public.ai_measurement_diagrams (customer_safe, ai_measurement_job_id);

-- Workflow rules engine extension (extends existing pipeline_automation_rules)
ALTER TABLE public.pipeline_automation_rules
  ADD COLUMN IF NOT EXISTS rule_type text NOT NULL DEFAULT 'when_if_then',
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'tenant', -- tenant | board | stage
  ADD COLUMN IF NOT EXISTS scope_id uuid,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS error_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pipeline_automation_rules_active_event
  ON public.pipeline_automation_rules (tenant_id, trigger_event, is_active);

-- Workflow rule execution audit log
CREATE TABLE IF NOT EXISTS public.workflow_rule_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  rule_id uuid NOT NULL REFERENCES public.pipeline_automation_rules(id) ON DELETE CASCADE,
  trigger_event text NOT NULL,
  source_record_type text,
  source_record_id uuid,
  matched boolean NOT NULL DEFAULT false,
  conditions_evaluated jsonb DEFAULT '{}'::jsonb,
  actions_executed jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'success', -- success | failed | skipped
  error_message text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_rule_executions_tenant_created
  ON public.workflow_rule_executions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_rule_executions_rule
  ON public.workflow_rule_executions (rule_id, created_at DESC);

ALTER TABLE public.workflow_rule_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can read rule executions"
  ON public.workflow_rule_executions
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Service role can write rule executions"
  ON public.workflow_rule_executions
  FOR INSERT
  WITH CHECK (true);