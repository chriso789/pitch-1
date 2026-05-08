
CREATE TABLE public.production_order_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  order_type TEXT NOT NULL CHECK (order_type IN ('material', 'labor', 'turnkey')),
  title TEXT NOT NULL,
  description TEXT,
  assigned_to_vendor_id UUID,
  assigned_to_crew TEXT,
  assigned_by UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'scheduled', 'in_progress', 'delivered', 'completed', 'cancelled')),
  scheduled_date DATE,
  arrival_date DATE,
  notes TEXT,
  estimate_id UUID,
  notify_rep BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.production_order_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can manage order assignments"
  ON public.production_order_assignments FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE INDEX idx_order_assignments_project ON public.production_order_assignments(project_id);
CREATE INDEX idx_order_assignments_tenant ON public.production_order_assignments(tenant_id);
