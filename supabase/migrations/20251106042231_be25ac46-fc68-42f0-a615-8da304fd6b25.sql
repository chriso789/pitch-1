-- Fix search path for cleanup function
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.api_rate_limits
  WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$;