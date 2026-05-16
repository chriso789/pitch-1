
-- 1. scope_compare_results: grouped/justification/score columns
ALTER TABLE public.scope_compare_results
  ADD COLUMN IF NOT EXISTS group_id text,
  ADD COLUMN IF NOT EXISTS parent_result_id uuid,
  ADD COLUMN IF NOT EXISTS grouped_children jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS match_score_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS justification jsonb,
  ADD COLUMN IF NOT EXISTS assembly_finding_id text;

CREATE INDEX IF NOT EXISTS idx_scope_compare_results_group_id ON public.scope_compare_results(group_id);
CREATE INDEX IF NOT EXISTS idx_scope_compare_results_parent ON public.scope_compare_results(parent_result_id);

-- 2. insurance_scope_line_items: evidence anchoring columns
ALTER TABLE public.insurance_scope_line_items
  ADD COLUMN IF NOT EXISTS page_number integer,
  ADD COLUMN IF NOT EXISTS raw_line text,
  ADD COLUMN IF NOT EXISTS previous_line text,
  ADD COLUMN IF NOT EXISTS next_line text,
  ADD COLUMN IF NOT EXISTS layout_type text,
  ADD COLUMN IF NOT EXISTS row_bbox jsonb,
  ADD COLUMN IF NOT EXISTS fingerprint text;

CREATE INDEX IF NOT EXISTS idx_insurance_scope_line_items_fingerprint
  ON public.insurance_scope_line_items(fingerprint);

-- 3. scope_compare_overrides: reviewer actions
CREATE TABLE IF NOT EXISTS public.scope_compare_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  compare_run_id uuid NOT NULL,
  result_id uuid NULL,
  override_type text NOT NULL,
  carrier_line_item_id uuid NULL,
  contractor_line_item_id uuid NULL,
  reviewer_note text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scope_compare_overrides_run ON public.scope_compare_overrides(compare_run_id);
CREATE INDEX IF NOT EXISTS idx_scope_compare_overrides_tenant ON public.scope_compare_overrides(tenant_id);

ALTER TABLE public.scope_compare_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view scope overrides"
  ON public.scope_compare_overrides;
CREATE POLICY "Tenant members can view scope overrides"
  ON public.scope_compare_overrides
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Tenant members can create scope overrides"
  ON public.scope_compare_overrides;
CREATE POLICY "Tenant members can create scope overrides"
  ON public.scope_compare_overrides
  FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Tenant members can update scope overrides"
  ON public.scope_compare_overrides;
CREATE POLICY "Tenant members can update scope overrides"
  ON public.scope_compare_overrides
  FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Tenant members can delete scope overrides"
  ON public.scope_compare_overrides;
CREATE POLICY "Tenant members can delete scope overrides"
  ON public.scope_compare_overrides
  FOR DELETE
  USING (tenant_id = public.get_user_tenant_id());
