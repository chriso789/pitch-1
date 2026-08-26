-- 1. Fix broken column reference (stage_key -> stage_status) in the archive helper
CREATE OR REPLACE FUNCTION public.try_auto_archive_pipeline_entry(_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry public.pipeline_entries%ROWTYPE;
  v_archive_on_entry boolean;
  v_archive_after_days integer;
  v_entered_at timestamptz;
  v_balance numeric;
BEGIN
  SELECT * INTO v_entry FROM public.pipeline_entries WHERE id = _entry_id;
  IF NOT FOUND OR v_entry.archived_at IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT ps.archive_on_entry, ps.archive_after_days
    INTO v_archive_on_entry, v_archive_after_days
  FROM public.pipeline_stages ps
  WHERE ps.tenant_id = v_entry.tenant_id
    AND (ps.key = v_entry.status OR ps.name = v_entry.status)
  LIMIT 1;

  IF NOT COALESCE(v_archive_on_entry, false) THEN
    RETURN;
  END IF;

  SELECT MAX(entered_at) INTO v_entered_at
  FROM public.pipeline_stage_history
  WHERE pipeline_entry_id = _entry_id
    AND stage_status = v_entry.status
    AND exited_at IS NULL;

  IF v_entered_at IS NULL THEN
    v_entered_at := v_entry.updated_at;
  END IF;

  -- A delay is configured: the hourly sweep handles moving/archiving later
  IF COALESCE(v_archive_after_days, 0) > 0 THEN
    RETURN;
  END IF;

  -- No delay configured: archive immediately when paid in full (balance <= 0)
  SELECT COALESCE(SUM(balance), 0) INTO v_balance
  FROM public.project_invoices
  WHERE pipeline_entry_id = _entry_id;

  IF v_balance <= 0 THEN
    UPDATE public.pipeline_entries SET archived_at = now() WHERE id = _entry_id;
  END IF;
END;
$function$;

-- 2. Sweep: move entries that have aged out of a closed stage into the next stage
CREATE OR REPLACE FUNCTION public.sweep_closed_stage_auto_advance(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_next_key text;
  v_entered_at timestamptz;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT pe.id, pe.tenant_id, pe.status, pe.updated_at,
           ps.stage_order, ps.archive_after_days
    FROM public.pipeline_entries pe
    JOIN public.pipeline_stages ps
      ON ps.tenant_id = pe.tenant_id
     AND (ps.key = pe.status OR ps.name = pe.status)
    WHERE pe.archived_at IS NULL
      AND COALESCE(pe.is_deleted, false) = false
      AND ps.archive_on_entry = true
      AND COALESCE(ps.archive_after_days, 0) > 0
    ORDER BY pe.updated_at
    LIMIT GREATEST(COALESCE(p_limit, 500), 1)
  LOOP
    SELECT MAX(entered_at) INTO v_entered_at
    FROM public.pipeline_stage_history
    WHERE pipeline_entry_id = r.id
      AND stage_status = r.status
      AND exited_at IS NULL;

    v_entered_at := COALESCE(v_entered_at, r.updated_at);

    CONTINUE WHEN v_entered_at > now() - (r.archive_after_days || ' days')::interval;

    SELECT ps2.key INTO v_next_key
    FROM public.pipeline_stages ps2
    WHERE ps2.tenant_id = r.tenant_id
      AND ps2.is_active = true
      AND ps2.stage_order > r.stage_order
      AND ps2.key IS NOT NULL
      AND ps2.key <> r.status
    ORDER BY ps2.stage_order
    LIMIT 1;

    IF v_next_key IS NOT NULL THEN
      UPDATE public.pipeline_entries
         SET status = v_next_key,
             status_entered_at = now(),
             updated_at = now()
       WHERE id = r.id;
    ELSE
      UPDATE public.pipeline_entries
         SET archived_at = now(),
             updated_at = now()
       WHERE id = r.id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_closed_stage_auto_advance(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_closed_stage_auto_advance(integer) TO service_role;

-- 3. Hourly schedule
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('closed-stage-auto-advance')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'closed-stage-auto-advance');
    PERFORM cron.schedule(
      'closed-stage-auto-advance',
      '17 * * * *',
      $cron$SELECT public.sweep_closed_stage_auto_advance(500);$cron$
    );
  END IF;
END $$;
