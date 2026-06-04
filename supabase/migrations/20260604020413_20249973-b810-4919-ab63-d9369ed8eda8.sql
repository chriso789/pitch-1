ALTER TABLE public.mskill_roof_edge_candidates
  ADD COLUMN IF NOT EXISTS soffit_data_source TEXT,
  ADD COLUMN IF NOT EXISTS soffit_exposure_ft NUMERIC,
  ADD COLUMN IF NOT EXISTS soffit_confidence TEXT,
  ADD COLUMN IF NOT EXISTS eave_source_type TEXT,
  ADD COLUMN IF NOT EXISTS rake_source_type TEXT,
  ADD COLUMN IF NOT EXISTS overhang_strategy TEXT,
  ADD COLUMN IF NOT EXISTS jurisdiction_default_used BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS roof_type_default_used BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS surface_refined BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS imagery_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confidence_reason TEXT,
  ADD COLUMN IF NOT EXISTS needs_review_reason TEXT;

CREATE TABLE IF NOT EXISTS public.soffit_eave_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_type TEXT NOT NULL CHECK (jurisdiction_type IN ('state','county','city','unknown')),
  jurisdiction_key TEXT,
  roof_type TEXT NOT NULL CHECK (roof_type IN ('shingle','tile','metal','flat','unknown')),
  structure_type TEXT NOT NULL DEFAULT 'unknown' CHECK (structure_type IN ('residential','commercial','unknown')),
  eave_exposure_min_ft NUMERIC,
  eave_exposure_default_ft NUMERIC NOT NULL,
  eave_exposure_max_ft NUMERIC,
  rake_exposure_min_ft NUMERIC,
  rake_exposure_default_ft NUMERIC NOT NULL,
  rake_exposure_max_ft NUMERIC,
  confidence TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('low','low-medium','medium','high')),
  source_reference TEXT,
  notes TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS soffit_eave_rules_lookup_idx
  ON public.soffit_eave_rules (jurisdiction_type, jurisdiction_key, roof_type, structure_type)
  WHERE enabled = TRUE;

GRANT SELECT ON public.soffit_eave_rules TO authenticated;
GRANT ALL ON public.soffit_eave_rules TO service_role;

ALTER TABLE public.soffit_eave_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read soffit/eave rules" ON public.soffit_eave_rules;
CREATE POLICY "Authenticated users can read soffit/eave rules"
  ON public.soffit_eave_rules FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Master/admin can manage soffit/eave rules" ON public.soffit_eave_rules;
CREATE POLICY "Master/admin can manage soffit/eave rules"
  ON public.soffit_eave_rules FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master'::app_role)
    OR public.has_role(auth.uid(), 'owner'::app_role)
    OR public.has_role(auth.uid(), 'office_admin'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master'::app_role)
    OR public.has_role(auth.uid(), 'owner'::app_role)
    OR public.has_role(auth.uid(), 'office_admin'::app_role)
  );

CREATE OR REPLACE FUNCTION public.soffit_eave_rules_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_soffit_eave_rules_updated_at ON public.soffit_eave_rules;
CREATE TRIGGER trg_soffit_eave_rules_updated_at
  BEFORE UPDATE ON public.soffit_eave_rules
  FOR EACH ROW EXECUTE FUNCTION public.soffit_eave_rules_set_updated_at();

INSERT INTO public.soffit_eave_rules
  (jurisdiction_type, jurisdiction_key, roof_type, structure_type,
   eave_exposure_min_ft, eave_exposure_default_ft, eave_exposure_max_ft,
   rake_exposure_min_ft, rake_exposure_default_ft, rake_exposure_max_ft,
   confidence, source_reference, notes)
VALUES
  ('unknown', NULL, 'unknown', 'unknown',
   0.5, 1.5, 3.0, 0.5, 1.5, 3.0,
   'low', 'generic_fallback',
   'Generic fallback. Use only when no jurisdiction or roof type is known.'),
  ('state', 'FL', 'unknown', 'residential',
   1.0, 2.0, 3.0, 0.5, 1.5, 2.5,
   'low-medium', 'fl_residential_typical',
   'Florida residential typical eave; roof type unknown.'),
  ('state', 'FL', 'tile', 'residential',
   1.5, 2.0, 3.0, 1.5, 2.0, 3.0,
   'medium', 'fl_tile_typical',
   'Florida tile roof typical exposure; only use when roof type confirmed.'),
  ('state', 'FL', 'metal', 'residential',
   1.0, 1.5, 2.5, 1.0, 1.5, 2.5,
   'medium', 'fl_metal_typical',
   'Florida metal roof typical exposure; only use when roof type confirmed.')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';