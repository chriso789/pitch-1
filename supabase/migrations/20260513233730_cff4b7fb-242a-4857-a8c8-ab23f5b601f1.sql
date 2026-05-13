CREATE TABLE IF NOT EXISTS public.task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  default_due_offset_days INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_templates_tenant ON public.task_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_use_count ON public.task_templates(tenant_id, use_count DESC);

ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view task templates"
ON public.task_templates
FOR SELECT
USING (
  tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  OR tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid())
);

CREATE POLICY "Managers can create task templates"
ON public.task_templates
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tenant_id = task_templates.tenant_id
      AND p.role IN ('master','corporate','office_admin','regional_manager','sales_manager','project_manager')
  )
);

CREATE POLICY "Managers can update task templates"
ON public.task_templates
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tenant_id = task_templates.tenant_id
      AND p.role IN ('master','corporate','office_admin','regional_manager','sales_manager','project_manager')
  )
);

CREATE POLICY "Managers can delete task templates"
ON public.task_templates
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tenant_id = task_templates.tenant_id
      AND p.role IN ('master','corporate','office_admin','regional_manager','sales_manager','project_manager')
  )
);

CREATE TRIGGER trg_task_templates_updated_at
BEFORE UPDATE ON public.task_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();