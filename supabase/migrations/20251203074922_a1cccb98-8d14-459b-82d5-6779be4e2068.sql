-- Enable RLS on roof_pitch_multipliers table
ALTER TABLE public.roof_pitch_multipliers ENABLE ROW LEVEL SECURITY;

-- Create read-only policy for authenticated users (reference data)
CREATE POLICY "Authenticated users can read pitch multipliers"
  ON public.roof_pitch_multipliers
  FOR SELECT
  TO authenticated
  USING (true);

-- Fix function search paths for security definer functions
ALTER FUNCTION public.generate_simple_job_number() SET search_path = public;
ALTER FUNCTION public.has_high_level_role(uuid) SET search_path = public;
ALTER FUNCTION public.auto_create_rep_commission_plan() SET search_path = public;
ALTER FUNCTION public.validate_canvass_token(text) SET search_path = public;
ALTER FUNCTION public.cleanup_expired_canvass_sessions() SET search_path = public;
ALTER FUNCTION public.audit_trigger_func() SET search_path = public;