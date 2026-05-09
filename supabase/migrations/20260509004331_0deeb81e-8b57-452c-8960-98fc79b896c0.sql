ALTER TABLE public.production_checklist_templates
  ADD COLUMN IF NOT EXISTS location_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_templates_tenant_location_stage
  ON public.production_checklist_templates(tenant_id, location_id, stage_key);