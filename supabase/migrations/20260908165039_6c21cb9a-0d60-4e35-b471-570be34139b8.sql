-- 1) Purge stale cron history (largest disk I/O source: 917 MB / 782k rows)
DELETE FROM cron.job_run_details WHERE start_time < now() - interval '2 days';

-- 4) Nightly retention sweep
CREATE OR REPLACE FUNCTION public.sweep_operational_log_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '2 days';
  DELETE FROM public.health_checks WHERE checked_at < now() - interval '3 days';
  DELETE FROM public.system_crashes WHERE created_at < now() - interval '30 days';
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_operational_log_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_operational_log_retention() TO service_role;

SELECT cron.schedule(
  'operational-log-retention-nightly',
  '10 3 * * *',
  $$SELECT public.sweep_operational_log_retention();$$
);