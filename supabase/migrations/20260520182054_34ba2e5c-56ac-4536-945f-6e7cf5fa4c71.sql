
TRUNCATE TABLE public.system_crashes;
TRUNCATE TABLE public.health_checks;

DELETE FROM public.tracking_events  WHERE created_at < now() - interval '90 days';
DELETE FROM public.user_activity_log WHERE created_at < now() - interval '90 days';

CREATE INDEX IF NOT EXISTS idx_system_crashes_created_at    ON public.system_crashes (created_at);
CREATE INDEX IF NOT EXISTS idx_health_checks_checked_at     ON public.health_checks (checked_at);
CREATE INDEX IF NOT EXISTS idx_tracking_events_created_at   ON public.tracking_events (created_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_created_at ON public.user_activity_log (created_at);

CREATE OR REPLACE FUNCTION public.prune_log_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.system_crashes    WHERE created_at < now() - interval '14 days';
  DELETE FROM public.health_checks     WHERE checked_at < now() - interval '7 days';
  DELETE FROM public.tracking_events   WHERE created_at < now() - interval '90 days';
  DELETE FROM public.user_activity_log WHERE created_at < now() - interval '90 days';
END;
$$;
