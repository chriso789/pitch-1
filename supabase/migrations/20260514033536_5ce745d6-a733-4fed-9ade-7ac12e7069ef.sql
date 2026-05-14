
ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS original_geocode_lat double precision,
  ADD COLUMN IF NOT EXISTS original_geocode_lng double precision,
  ADD COLUMN IF NOT EXISTS confirmed_roof_center_lat double precision,
  ADD COLUMN IF NOT EXISTS confirmed_roof_center_lng double precision,
  ADD COLUMN IF NOT EXISTS marker_offset_ft numeric,
  ADD COLUMN IF NOT EXISTS user_confirmed_roof_target boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS roof_target_confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS roof_target_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS roof_target_admin_override boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.roof_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id uuid NOT NULL REFERENCES public.roof_measurements(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  layer_id text NOT NULL DEFAULT 'layer_1_perimeter',
  geometry_px jsonb NOT NULL,
  geometry_geo jsonb,
  length_lf numeric,
  non_dimensional_attribute text NOT NULL CHECK (non_dimensional_attribute IN (
    'perimeter','eave','rake','ridge','hip','valley',
    'step_flashing','wall_flashing','common','unknown'
  )),
  source text NOT NULL CHECK (source IN ('dsm','solar','mask_contour','user_override','inferred')),
  confidence numeric,
  adjacent_plane_ids uuid[] DEFAULT '{}',
  can_be_customer_reported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roof_lines_measurement ON public.roof_lines(measurement_id);
CREATE INDEX IF NOT EXISTS idx_roof_lines_tenant ON public.roof_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_roof_lines_attr ON public.roof_lines(non_dimensional_attribute);

ALTER TABLE public.roof_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roof_lines tenant select" ON public.roof_lines;
CREATE POLICY "roof_lines tenant select" ON public.roof_lines
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.has_role(auth.uid(), 'master'::public.app_role));

DROP POLICY IF EXISTS "roof_lines tenant insert" ON public.roof_lines;
CREATE POLICY "roof_lines tenant insert" ON public.roof_lines
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.has_role(auth.uid(), 'master'::public.app_role));

DROP POLICY IF EXISTS "roof_lines tenant update" ON public.roof_lines;
CREATE POLICY "roof_lines tenant update" ON public.roof_lines
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id() OR public.has_role(auth.uid(), 'master'::public.app_role));

DROP POLICY IF EXISTS "roof_lines tenant delete" ON public.roof_lines;
CREATE POLICY "roof_lines tenant delete" ON public.roof_lines
  FOR DELETE USING (tenant_id = public.get_user_tenant_id() OR public.has_role(auth.uid(), 'master'::public.app_role));

CREATE TABLE IF NOT EXISTS public.measurement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id uuid NOT NULL REFERENCES public.roof_measurements(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  override_kind text NOT NULL CHECK (override_kind IN (
    'perimeter_point_moved','line_added','line_deleted',
    'line_type_changed','pitch_overridden','reference_length_overridden'
  )),
  target_line_id uuid,
  target_plane_id uuid,
  before jsonb,
  after jsonb,
  override_source text NOT NULL DEFAULT 'user_verified',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurement_overrides_measurement
  ON public.measurement_overrides(measurement_id);
CREATE INDEX IF NOT EXISTS idx_measurement_overrides_tenant
  ON public.measurement_overrides(tenant_id);

ALTER TABLE public.measurement_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "measurement_overrides tenant select" ON public.measurement_overrides;
CREATE POLICY "measurement_overrides tenant select" ON public.measurement_overrides
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.has_role(auth.uid(), 'master'::public.app_role));

DROP POLICY IF EXISTS "measurement_overrides manager insert" ON public.measurement_overrides;
CREATE POLICY "measurement_overrides manager insert" ON public.measurement_overrides
  FOR INSERT WITH CHECK (
    (tenant_id = public.get_user_tenant_id() AND (
      public.has_role(auth.uid(), 'owner'::public.app_role) OR
      public.has_role(auth.uid(), 'corporate'::public.app_role) OR
      public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
      public.has_role(auth.uid(), 'regional_manager'::public.app_role) OR
      public.has_role(auth.uid(), 'sales_manager'::public.app_role) OR
      public.has_role(auth.uid(), 'project_manager'::public.app_role)
    )) OR public.has_role(auth.uid(), 'master'::public.app_role)
  );

DROP POLICY IF EXISTS "measurement_overrides manager update" ON public.measurement_overrides;
CREATE POLICY "measurement_overrides manager update" ON public.measurement_overrides
  FOR UPDATE USING (
    (tenant_id = public.get_user_tenant_id() AND (
      public.has_role(auth.uid(), 'owner'::public.app_role) OR
      public.has_role(auth.uid(), 'corporate'::public.app_role) OR
      public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
      public.has_role(auth.uid(), 'regional_manager'::public.app_role) OR
      public.has_role(auth.uid(), 'sales_manager'::public.app_role) OR
      public.has_role(auth.uid(), 'project_manager'::public.app_role)
    )) OR public.has_role(auth.uid(), 'master'::public.app_role)
  );

DROP POLICY IF EXISTS "measurement_overrides manager delete" ON public.measurement_overrides;
CREATE POLICY "measurement_overrides manager delete" ON public.measurement_overrides
  FOR DELETE USING (
    (tenant_id = public.get_user_tenant_id() AND (
      public.has_role(auth.uid(), 'owner'::public.app_role) OR
      public.has_role(auth.uid(), 'corporate'::public.app_role) OR
      public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
      public.has_role(auth.uid(), 'regional_manager'::public.app_role) OR
      public.has_role(auth.uid(), 'sales_manager'::public.app_role) OR
      public.has_role(auth.uid(), 'project_manager'::public.app_role)
    )) OR public.has_role(auth.uid(), 'master'::public.app_role)
  );

ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS recalculated_from_overrides boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_validation_status text
    CHECK (override_validation_status IN ('pending','passed','failed')),
  ADD COLUMN IF NOT EXISTS pitch_source text,
  ADD COLUMN IF NOT EXISTS block_customer_report_reason text;
