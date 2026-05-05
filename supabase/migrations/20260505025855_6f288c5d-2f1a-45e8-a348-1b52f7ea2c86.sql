-- Add validation columns to ai_measurement_results
ALTER TABLE public.ai_measurement_results
  ADD COLUMN IF NOT EXISTS is_valid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fail_reasons text[],
  ADD COLUMN IF NOT EXISTS area_ratio numeric,
  ADD COLUMN IF NOT EXISTS footprint_confidence numeric,
  ADD COLUMN IF NOT EXISTS coverage numeric,
  ADD COLUMN IF NOT EXISTS validated_face_count integer,
  ADD COLUMN IF NOT EXISTS total_face_count integer;

-- Create reusable validation function
CREATE OR REPLACE FUNCTION public.validate_measurement(
  p_coverage numeric,
  p_validated_faces int,
  p_total_faces int,
  p_footprint_confidence numeric,
  p_area_flat numeric,
  p_area_adjusted numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  failures text[] := '{}';
  ratio numeric;
BEGIN
  ratio := p_area_adjusted / NULLIF(p_area_flat, 0);

  -- RULE 1: coverage must be >= 85%
  IF p_coverage IS NULL OR p_coverage < 0.85 THEN
    failures := array_append(failures, 'LOW_COVERAGE');
  END IF;

  -- RULE 2: at least 70% of faces must be validated
  IF p_total_faces = 0 OR p_validated_faces < p_total_faces * 0.7 THEN
    failures := array_append(failures, 'INVALID_FACES');
  END IF;

  -- RULE 3: footprint confidence must be >= 0.9
  IF p_footprint_confidence IS NULL OR p_footprint_confidence < 0.9 THEN
    failures := array_append(failures, 'WEAK_FOOTPRINT');
  END IF;

  -- RULE 4: area ratio must be <= 1.25
  IF ratio IS NOT NULL AND ratio > 1.25 THEN
    failures := array_append(failures, 'AREA_INFLATION');
  END IF;

  result := jsonb_build_object(
    'is_valid', array_length(failures, 1) IS NULL,
    'fail_reasons', failures,
    'area_ratio', ratio
  );

  RETURN result;
END;
$$;