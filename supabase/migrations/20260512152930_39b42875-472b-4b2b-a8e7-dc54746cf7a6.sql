
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS pipeline_lead_visibility_days INTEGER NOT NULL DEFAULT 90;

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
  v_balance numeric;
  v_visibility_days integer;
BEGIN
  SELECT * INTO v_entry FROM public.pipeline_entries WHERE id = _entry_id;
  IF NOT FOUND OR v_entry.archived_at IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT ps.archive_on_entry INTO v_archive_on_entry
  FROM public.pipeline_stages ps
  WHERE ps.tenant_id = v_entry.tenant_id
    AND (ps.key = v_entry.status OR ps.name = v_entry.status)
  LIMIT 1;

  IF COALESCE(v_archive_on_entry, false) THEN
    SELECT COALESCE(SUM(balance), 0) INTO v_balance
    FROM public.project_invoices
    WHERE pipeline_entry_id = _entry_id;

    IF v_balance <= 0 THEN
      UPDATE public.pipeline_entries SET archived_at = now() WHERE id = _entry_id;
      RETURN;
    END IF;
  END IF;

  SELECT pipeline_lead_visibility_days INTO v_visibility_days
  FROM public.tenant_settings
  WHERE tenant_id = v_entry.tenant_id
  LIMIT 1;

  IF COALESCE(v_visibility_days, 0) > 0
     AND v_entry.created_at < now() - (v_visibility_days || ' days')::interval THEN
    UPDATE public.pipeline_entries SET archived_at = now() WHERE id = _entry_id;
  END IF;
END;
$$;
