CREATE TABLE IF NOT EXISTS public.plan_sheet_scales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid REFERENCES public.commercial_projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  page_index integer NOT NULL CHECK (page_index >= 0),
  name text NOT NULL DEFAULT 'Sheet',
  viewport_bbox jsonb,
  units_per_user_unit numeric NOT NULL CHECK (units_per_user_unit > 0),
  unit text NOT NULL DEFAULT 'ft',
  method text NOT NULL CHECK (method IN ('calibrated','stated_ratio')),
  calibration jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification jsonb,
  verified boolean NOT NULL DEFAULT false,
  engine text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_sheet_scales TO authenticated;
GRANT ALL ON public.plan_sheet_scales TO service_role;
ALTER TABLE public.plan_sheet_scales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access" ON public.plan_sheet_scales FOR ALL TO authenticated
  USING (public.commercial_can_access_tenant(tenant_id) AND NOT (SELECT public.is_login_blocked()))
  WITH CHECK (public.commercial_can_access_tenant(tenant_id) AND NOT (SELECT public.is_login_blocked()));
CREATE INDEX IF NOT EXISTS plan_sheet_scales_doc_idx ON public.plan_sheet_scales(tenant_id, document_id, page_index);

CREATE TABLE IF NOT EXISTS public.plan_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid REFERENCES public.commercial_projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  page_index integer NOT NULL CHECK (page_index >= 0),
  scale_id uuid REFERENCES public.plan_sheet_scales(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('distance','perimeter','area','roof_area')),
  points jsonb NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  pitch_rise numeric CHECK (pitch_rise IS NULL OR (pitch_rise >= 0 AND pitch_rise <= 24)),
  label text,
  driver text,
  roof_section text,
  source text NOT NULL CHECK (source IN ('manual_calibrated','vector_snapped','ocr_derived','ai_estimated')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','exported')),
  takeoff_quantity_id uuid REFERENCES public.commercial_takeoff_quantities(id) ON DELETE SET NULL,
  engine text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_measurements TO authenticated;
GRANT ALL ON public.plan_measurements TO service_role;
ALTER TABLE public.plan_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access" ON public.plan_measurements FOR ALL TO authenticated
  USING (public.commercial_can_access_tenant(tenant_id) AND NOT (SELECT public.is_login_blocked()))
  WITH CHECK (public.commercial_can_access_tenant(tenant_id) AND NOT (SELECT public.is_login_blocked()));
CREATE INDEX IF NOT EXISTS plan_measurements_doc_idx ON public.plan_measurements(tenant_id, document_id, page_index);
CREATE INDEX IF NOT EXISTS plan_measurements_project_idx ON public.plan_measurements(project_id);

CREATE TABLE IF NOT EXISTS public.plan_measurement_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  measurement_id uuid NOT NULL,
  revision integer NOT NULL,
  action text NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plan_measurement_revisions TO authenticated;
GRANT ALL ON public.plan_measurement_revisions TO service_role;
ALTER TABLE public.plan_measurement_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read" ON public.plan_measurement_revisions FOR SELECT TO authenticated
  USING (public.commercial_can_access_tenant(tenant_id) AND NOT (SELECT public.is_login_blocked()));
CREATE INDEX IF NOT EXISTS plan_measurement_revisions_m_idx ON public.plan_measurement_revisions(measurement_id, revision);

CREATE OR REPLACE FUNCTION public.plan_measurement_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.plan_sheet_scales%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Exported quantities are locked; re-measure instead of editing.
    IF OLD.status = 'exported' AND (NEW.points IS DISTINCT FROM OLD.points OR NEW.value IS DISTINCT FROM OLD.value OR NEW.scale_id IS DISTINCT FROM OLD.scale_id) THEN
      RAISE EXCEPTION 'Exported measurements are locked';
    END IF;
    IF NEW.points IS DISTINCT FROM OLD.points OR NEW.value IS DISTINCT FROM OLD.value OR NEW.status IS DISTINCT FROM OLD.status OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.pitch_rise IS DISTINCT FROM OLD.pitch_rise THEN
      NEW.revision := OLD.revision + 1;
    END IF;
    NEW.updated_at := now();
  END IF;
  -- Calibrated sources require a scale on the same sheet; never an assumed scale.
  IF NEW.source IN ('manual_calibrated','vector_snapped') THEN
    IF NEW.scale_id IS NULL THEN RAISE EXCEPTION 'A calibrated scale is required for measured quantities'; END IF;
    SELECT * INTO s FROM public.plan_sheet_scales WHERE id = NEW.scale_id;
    IF s.document_id <> NEW.document_id OR s.page_index <> NEW.page_index OR s.tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'Scale belongs to a different sheet';
    END IF;
    IF NEW.status IN ('approved','exported') AND NOT s.verified THEN
      RAISE EXCEPTION 'Scale must be verified against a known dimension before approval';
    END IF;
  END IF;
  IF NEW.status IN ('approved','exported') AND NEW.source = 'ai_estimated' THEN
    RAISE EXCEPTION 'AI-estimated quantities cannot be approved as measurements';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS plan_measurement_guard_trg ON public.plan_measurements;
CREATE TRIGGER plan_measurement_guard_trg BEFORE INSERT OR UPDATE ON public.plan_measurements
  FOR EACH ROW EXECUTE FUNCTION public.plan_measurement_guard();

CREATE OR REPLACE FUNCTION public.plan_measurement_log_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.revision <> OLD.revision THEN
    INSERT INTO public.plan_measurement_revisions(tenant_id, measurement_id, revision, action, snapshot, changed_by)
    VALUES (NEW.tenant_id, NEW.id, NEW.revision, lower(TG_OP), to_jsonb(NEW), auth.uid());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS plan_measurement_log_trg ON public.plan_measurements;
CREATE TRIGGER plan_measurement_log_trg AFTER INSERT OR UPDATE ON public.plan_measurements
  FOR EACH ROW EXECUTE FUNCTION public.plan_measurement_log_revision();

NOTIFY pgrst, 'reload schema';