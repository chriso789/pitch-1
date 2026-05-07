
-- Production checklist templates (configurable per stage)
CREATE TABLE public.production_checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  stage_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  item_description TEXT,
  is_required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  trade_type TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.production_checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view checklist templates"
  ON public.production_checklist_templates FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Managers can insert checklist templates"
  ON public.production_checklist_templates FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager', 'project_manager')
  ));

CREATE POLICY "Managers can update checklist templates"
  ON public.production_checklist_templates FOR UPDATE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager', 'project_manager')
  ));

CREATE POLICY "Managers can delete checklist templates"
  ON public.production_checklist_templates FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager', 'project_manager')
  ));

-- Checklist completions per workflow
CREATE TABLE public.production_checklist_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  production_workflow_id UUID NOT NULL REFERENCES public.production_workflows(id) ON DELETE CASCADE,
  checklist_template_id UUID NOT NULL REFERENCES public.production_checklist_templates(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(production_workflow_id, checklist_template_id)
);

ALTER TABLE public.production_checklist_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view checklist completions"
  ON public.production_checklist_completions FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant users can manage checklist completions"
  ON public.production_checklist_completions FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Trade boards per project
CREATE TABLE public.production_trade_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  production_workflow_id UUID REFERENCES public.production_workflows(id) ON DELETE CASCADE,
  trade_name TEXT NOT NULL,
  trade_type TEXT NOT NULL,
  current_stage TEXT NOT NULL DEFAULT 'submit_documents',
  estimate_id UUID,
  assigned_to UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, trade_type, tenant_id)
);

ALTER TABLE public.production_trade_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view trade boards"
  ON public.production_trade_boards FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant users can manage trade boards"
  ON public.production_trade_boards FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Trade-specific checklist completions
CREATE TABLE public.production_trade_checklist_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  trade_board_id UUID NOT NULL REFERENCES public.production_trade_boards(id) ON DELETE CASCADE,
  checklist_template_id UUID NOT NULL REFERENCES public.production_checklist_templates(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(trade_board_id, checklist_template_id)
);

ALTER TABLE public.production_trade_checklist_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view trade checklist completions"
  ON public.production_trade_checklist_completions FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant users can manage trade checklist completions"
  ON public.production_trade_checklist_completions FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Indexes
CREATE INDEX idx_checklist_templates_stage ON public.production_checklist_templates(tenant_id, stage_key);
CREATE INDEX idx_checklist_completions_workflow ON public.production_checklist_completions(production_workflow_id);
CREATE INDEX idx_trade_boards_project ON public.production_trade_boards(project_id, tenant_id);
CREATE INDEX idx_trade_checklist_board ON public.production_trade_checklist_completions(trade_board_id);
