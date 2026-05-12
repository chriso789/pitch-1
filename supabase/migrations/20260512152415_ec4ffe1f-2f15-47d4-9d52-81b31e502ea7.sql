
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS archive_on_entry boolean NOT NULL DEFAULT false;

ALTER TABLE public.pipeline_entries
  ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;
CREATE INDEX IF NOT EXISTS idx_pipeline_entries_archived_at
  ON public.pipeline_entries (tenant_id, archived_at);

CREATE TABLE IF NOT EXISTS public.pipeline_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pipeline_entry_id uuid NOT NULL REFERENCES public.pipeline_entries(id) ON DELETE CASCADE,
  stage_status text NOT NULL,
  entered_at timestamp with time zone NOT NULL DEFAULT now(),
  exited_at timestamp with time zone,
  duration_seconds integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_psh_tenant_stage ON public.pipeline_stage_history (tenant_id, stage_status);
CREATE INDEX IF NOT EXISTS idx_psh_entry ON public.pipeline_stage_history (pipeline_entry_id);

ALTER TABLE public.pipeline_stage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "psh_select_tenant" ON public.pipeline_stage_history;
CREATE POLICY "psh_select_tenant"
  ON public.pipeline_stage_history FOR SELECT
  USING (tenant_id = public.get_user_active_tenant_id() OR tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "psh_insert_system" ON public.pipeline_stage_history;
CREATE POLICY "psh_insert_system"
  ON public.pipeline_stage_history FOR INSERT
  WITH CHECK (tenant_id = public.get_user_active_tenant_id() OR tenant_id = public.get_user_tenant_id());

CREATE OR REPLACE FUNCTION public.try_auto_archive_pipeline_entry(p_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_stage_archive boolean;
  v_total_balance numeric;
  v_already_archived timestamp with time zone;
  v_status text;
  v_tenant uuid;
BEGIN
  SELECT pe.status, pe.tenant_id, pe.archived_at
    INTO v_status, v_tenant, v_already_archived
  FROM public.pipeline_entries pe WHERE pe.id = p_entry_id;
  IF v_already_archived IS NOT NULL THEN RETURN false; END IF;

  SELECT COALESCE(ps.archive_on_entry, false) INTO v_stage_archive
  FROM public.pipeline_stages ps
  WHERE ps.tenant_id = v_tenant
    AND (ps.key = v_status OR lower(ps.name) = lower(v_status))
  LIMIT 1;
  IF NOT COALESCE(v_stage_archive, false) THEN RETURN false; END IF;

  SELECT COALESCE(SUM(balance), 0) INTO v_total_balance
  FROM public.project_invoices WHERE pipeline_entry_id = p_entry_id;
  IF v_total_balance > 0 THEN RETURN false; END IF;

  UPDATE public.pipeline_entries SET archived_at = now() WHERE id = p_entry_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_pipeline_entry_status_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pipeline_stage_history (tenant_id, pipeline_entry_id, stage_status, entered_at)
    VALUES (NEW.tenant_id, NEW.id, NEW.status, COALESCE(NEW.status_entered_at, now()));
    PERFORM public.try_auto_archive_pipeline_entry(NEW.id);
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.pipeline_stage_history
       SET exited_at = now(),
           duration_seconds = EXTRACT(EPOCH FROM (now() - entered_at))::int
     WHERE pipeline_entry_id = NEW.id AND stage_status = OLD.status AND exited_at IS NULL;
    INSERT INTO public.pipeline_stage_history (tenant_id, pipeline_entry_id, stage_status, entered_at)
    VALUES (NEW.tenant_id, NEW.id, NEW.status, now());
    PERFORM public.try_auto_archive_pipeline_entry(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipeline_entry_status_change ON public.pipeline_entries;
CREATE TRIGGER trg_pipeline_entry_status_change
AFTER INSERT OR UPDATE OF status ON public.pipeline_entries
FOR EACH ROW EXECUTE FUNCTION public.handle_pipeline_entry_status_change();

CREATE OR REPLACE FUNCTION public.handle_invoice_balance_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.pipeline_entry_id IS NOT NULL
     AND COALESCE(NEW.balance, 0) <= 0
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.balance, -1) <> COALESCE(NEW.balance, -1)) THEN
    PERFORM public.try_auto_archive_pipeline_entry(NEW.pipeline_entry_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_balance_archive ON public.project_invoices;
CREATE TRIGGER trg_invoice_balance_archive
AFTER INSERT OR UPDATE OF balance ON public.project_invoices
FOR EACH ROW EXECUTE FUNCTION public.handle_invoice_balance_change();

CREATE OR REPLACE FUNCTION public.pipeline_stage_avg_durations(p_tenant_id uuid)
RETURNS TABLE (
  stage_status text, entries_count bigint,
  avg_days numeric, median_days numeric, min_days numeric, max_days numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    stage_status,
    COUNT(*)::bigint,
    ROUND((AVG(duration_seconds) / 86400.0)::numeric, 2),
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_seconds) / 86400.0)::numeric, 2),
    ROUND((MIN(duration_seconds) / 86400.0)::numeric, 2),
    ROUND((MAX(duration_seconds) / 86400.0)::numeric, 2)
  FROM public.pipeline_stage_history
  WHERE tenant_id = p_tenant_id AND duration_seconds IS NOT NULL
  GROUP BY stage_status
  ORDER BY 3 DESC NULLS LAST;
$$;
