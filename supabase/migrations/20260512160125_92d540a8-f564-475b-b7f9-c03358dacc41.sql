
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS archive_after_days integer NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.try_auto_archive_pipeline_entry(uuid);

CREATE OR REPLACE FUNCTION public.try_auto_archive_pipeline_entry(_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Look up the current stage for this entry
  SELECT ps.archive_on_entry, ps.archive_after_days
    INTO v_archive_on_entry, v_archive_after_days
  FROM public.pipeline_stages ps
  WHERE ps.tenant_id = v_entry.tenant_id
    AND (ps.key = v_entry.status OR ps.name = v_entry.status)
  LIMIT 1;

  -- Only archive entries whose CURRENT stage is flagged as a closed/archive stage
  IF NOT COALESCE(v_archive_on_entry, false) THEN
    RETURN;
  END IF;

  -- Determine when the entry entered its current stage
  SELECT MAX(entered_at) INTO v_entered_at
  FROM public.pipeline_stage_history
  WHERE pipeline_entry_id = _entry_id
    AND stage_key = v_entry.status
    AND exited_at IS NULL;

  IF v_entered_at IS NULL THEN
    v_entered_at := v_entry.updated_at;
  END IF;

  -- If a delay is configured, only archive after the configured number of days
  IF COALESCE(v_archive_after_days, 0) > 0 THEN
    IF v_entered_at > now() - (v_archive_after_days || ' days')::interval THEN
      RETURN;
    END IF;
    UPDATE public.pipeline_entries SET archived_at = now() WHERE id = _entry_id;
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
$$;
