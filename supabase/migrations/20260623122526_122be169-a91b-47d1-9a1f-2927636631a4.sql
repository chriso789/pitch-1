
CREATE TABLE IF NOT EXISTS public.platform_feature_flags (
  feature_key TEXT PRIMARY KEY,
  disabled BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  disabled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_feature_flags TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_feature_flags TO authenticated;
GRANT ALL ON public.platform_feature_flags TO service_role;

ALTER TABLE public.platform_feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read platform feature flags"
  ON public.platform_feature_flags
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only master role can insert platform feature flags"
  ON public.platform_feature_flags
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "Only master role can update platform feature flags"
  ON public.platform_feature_flags
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "Only master role can delete platform feature flags"
  ON public.platform_feature_flags
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role));

CREATE OR REPLACE FUNCTION public.update_platform_feature_flags_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_feature_flags_updated_at ON public.platform_feature_flags;
CREATE TRIGGER trg_platform_feature_flags_updated_at
  BEFORE UPDATE ON public.platform_feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_platform_feature_flags_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_feature_flags;
