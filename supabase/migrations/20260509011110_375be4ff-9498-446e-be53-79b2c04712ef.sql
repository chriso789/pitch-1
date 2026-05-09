
CREATE TABLE IF NOT EXISTS public.production_checklist_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  location_id UUID NULL,
  stage_key TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'bg-slate-500',
  icon TEXT NOT NULL DEFAULT 'ClipboardList',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pcs_tenant_loc ON public.production_checklist_stages(tenant_id, location_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pcs_tenant_loc_key ON public.production_checklist_stages(tenant_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), stage_key);

ALTER TABLE public.production_checklist_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members manage checklist stages"
  ON public.production_checklist_stages
  FOR ALL
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER trg_pcs_updated_at
  BEFORE UPDATE ON public.production_checklist_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
