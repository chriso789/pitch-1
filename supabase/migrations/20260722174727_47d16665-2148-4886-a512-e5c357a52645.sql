
ALTER TABLE public.sms_blasts
  ADD COLUMN IF NOT EXISTS completion_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_exhausted_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.sms_blast_completion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blast_id uuid NOT NULL REFERENCES public.sms_blasts(id) ON DELETE CASCADE,
  tenant_id uuid,
  previous_status text NOT NULL,
  new_status text NOT NULL,
  completion_reason text NOT NULL,
  summary_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  processor_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_blast_completion_events_blast_idx
  ON public.sms_blast_completion_events (blast_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_blast_completion_events_tenant_idx
  ON public.sms_blast_completion_events (tenant_id, created_at DESC);

GRANT SELECT ON public.sms_blast_completion_events TO authenticated;
GRANT ALL ON public.sms_blast_completion_events TO service_role;

ALTER TABLE public.sms_blast_completion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read blast completion events" ON public.sms_blast_completion_events;
CREATE POLICY "tenant read blast completion events"
  ON public.sms_blast_completion_events
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'master'::public.app_role
    )
  );

DROP POLICY IF EXISTS "no client writes on blast completion events" ON public.sms_blast_completion_events;
CREATE POLICY "no client writes on blast completion events"
  ON public.sms_blast_completion_events
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.complete_sms_blast_if_done(
  p_blast_id uuid,
  p_processor_run_id uuid DEFAULT NULL
) RETURNS TABLE(transitioned boolean, new_status text, completion_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blast public.sms_blasts%ROWTYPE;
  v_active int;
  v_sent int;
  v_delivered int;
  v_failed int;
  v_retry_exh int;
  v_quar int;
  v_opted int;
  v_replied int;
  v_cancelled int;
  v_new_status text;
  v_reason text;
  v_summary jsonb;
BEGIN
  SELECT * INTO v_blast FROM public.sms_blasts WHERE id = p_blast_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_blast.status <> 'sending' THEN
    RETURN QUERY SELECT false, v_blast.status, v_blast.completion_reason;
    RETURN;
  END IF;

  SELECT
    count(*) FILTER (WHERE status IN ('pending','claimed')),
    count(*) FILTER (WHERE status = 'sent'),
    count(*) FILTER (WHERE status = 'delivered'),
    count(*) FILTER (WHERE status = 'failed' AND coalesce(last_error,'') NOT LIKE 'retry_exhausted%'),
    count(*) FILTER (WHERE status = 'failed' AND coalesce(last_error,'') LIKE 'retry_exhausted%'),
    count(*) FILTER (WHERE status = 'quarantined'),
    count(*) FILTER (WHERE status = 'opted_out'),
    count(*) FILTER (WHERE status = 'replied'),
    count(*) FILTER (WHERE status = 'cancelled')
  INTO
    v_active, v_sent, v_delivered, v_failed, v_retry_exh,
    v_quar, v_opted, v_replied, v_cancelled
  FROM public.sms_blast_items
  WHERE blast_id = p_blast_id;

  IF v_active > 0 THEN
    RETURN QUERY SELECT false, v_blast.status, v_blast.completion_reason;
    RETURN;
  END IF;

  IF (v_failed + v_retry_exh + v_quar + v_opted + v_replied + v_cancelled) > 0 THEN
    v_new_status := 'completed_with_warnings';
    v_reason := 'completed_with_warnings';
  ELSE
    v_new_status := 'completed';
    v_reason := 'all_successful';
  END IF;

  v_summary := jsonb_build_object(
    'total',           v_sent + v_delivered + v_failed + v_retry_exh + v_quar + v_opted + v_replied + v_cancelled,
    'sent',            v_sent,
    'delivered',       v_delivered,
    'failed',          v_failed,
    'retry_exhausted', v_retry_exh,
    'quarantined',     v_quar,
    'opted_out',       v_opted,
    'replied',         v_replied,
    'cancelled',       v_cancelled
  );

  UPDATE public.sms_blasts
     SET status                = v_new_status,
         completion_reason     = v_reason,
         completed_at          = COALESCE(completed_at, now()),
         sent_count            = v_sent + v_delivered + v_replied,
         delivered_count       = v_delivered,
         replied_count         = v_replied,
         failed_count          = v_failed,
         retry_exhausted_count = v_retry_exh,
         quarantined_count     = v_quar,
         opted_out_count       = v_opted,
         cancelled_count       = v_cancelled,
         updated_at            = now()
   WHERE id = p_blast_id
     AND status = 'sending';

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, v_new_status, v_reason;
    RETURN;
  END IF;

  INSERT INTO public.sms_blast_completion_events (
    blast_id, tenant_id, previous_status, new_status,
    completion_reason, summary_counts, processor_run_id
  ) VALUES (
    p_blast_id, v_blast.tenant_id, 'sending', v_new_status,
    v_reason, v_summary, p_processor_run_id
  );

  RETURN QUERY SELECT true, v_new_status, v_reason;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_sms_blast_if_done(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
