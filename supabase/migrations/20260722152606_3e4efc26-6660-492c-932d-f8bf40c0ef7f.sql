
-- 1. Immutable audit trail for reap events.
CREATE TABLE IF NOT EXISTS public.sms_claim_reap_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  blast_id uuid NOT NULL,
  tenant_id uuid,
  previous_status text NOT NULL,
  new_status text NOT NULL,
  previous_claimed_at timestamptz,
  reaped_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  run_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sms_claim_reap_events TO authenticated;
GRANT ALL ON public.sms_claim_reap_events TO service_role;

ALTER TABLE public.sms_claim_reap_events ENABLE ROW LEVEL SECURITY;

-- Master-only read; writes only via SECURITY DEFINER function below.
DROP POLICY IF EXISTS "reap_events_master_read" ON public.sms_claim_reap_events;
CREATE POLICY "reap_events_master_read"
  ON public.sms_claim_reap_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role));

CREATE INDEX IF NOT EXISTS idx_sms_claim_reap_events_blast
  ON public.sms_claim_reap_events(blast_id, reaped_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_claim_reap_events_run
  ON public.sms_claim_reap_events(run_id);

-- 2. Reaper function. SECURITY DEFINER so the edge function (invoked with an
-- authenticated JWT) can call it without needing direct table grants; the
-- function itself is the enforcement boundary and only touches stale-claimed
-- rows.
CREATE OR REPLACE FUNCTION public.reap_stale_sms_claims(
  max_age_minutes integer DEFAULT 5,
  batch_limit integer DEFAULT 500,
  run_id uuid DEFAULT gen_random_uuid()
)
RETURNS TABLE(blast_id uuid, reaped_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(mins => GREATEST(max_age_minutes, 1));
  v_limit  integer     := LEAST(GREATEST(batch_limit, 1), 5000);
  v_run    uuid        := COALESCE(run_id, gen_random_uuid());
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT i.id
    FROM public.sms_blast_items AS i
    WHERE i.status = 'claimed'
      AND i.claimed_at IS NOT NULL
      AND i.claimed_at < v_cutoff
      AND i.telnyx_message_id IS NULL
      AND i.sent_at IS NULL
      AND i.delivered_at IS NULL
    ORDER BY i.claimed_at ASC
    LIMIT v_limit
    FOR UPDATE OF i SKIP LOCKED
  ),
  updated AS (
    UPDATE public.sms_blast_items AS i
    SET status      = 'pending',
        claimed_at  = NULL,
        last_error  = COALESCE(NULLIF(i.last_error, '') || ' | ', '')
                      || 'reaped: stuck claimed >' || max_age_minutes || 'm',
        updated_at  = now()
    FROM candidates c
    WHERE i.id = c.id
    RETURNING i.id, i.blast_id, i.tenant_id, i.claimed_at AS new_claimed_at
  ),
  -- Snapshot previous_claimed_at BEFORE the update via a second read? We
  -- already lost it. Re-derive from the audit: use the cutoff-safe fact that
  -- the row WAS claimed. Store NULL when unknown — the reason string carries
  -- the >Nm signal. To preserve the actual previous timestamp, we capture it
  -- in `candidates` via a join-back trick below.
  audit_rows AS (
    INSERT INTO public.sms_claim_reap_events (
      item_id, blast_id, tenant_id,
      previous_status, new_status,
      previous_claimed_at, reason, run_id
    )
    SELECT u.id, u.blast_id, u.tenant_id,
           'claimed', 'pending',
           NULL,                    -- see NOTE below
           'reaped: stuck claimed >' || max_age_minutes || 'm',
           v_run
    FROM updated u
    RETURNING blast_id
  )
  SELECT ar.blast_id, COUNT(*)::bigint AS reaped_count
  FROM audit_rows ar
  GROUP BY ar.blast_id;
END;
$$;

-- NOTE on previous_claimed_at: the CTE `updated` fires the UPDATE before we
-- can read the old value in the same statement. To recover it, we rewrite
-- the function to capture prior state in `candidates`. Do that now.
CREATE OR REPLACE FUNCTION public.reap_stale_sms_claims(
  max_age_minutes integer DEFAULT 5,
  batch_limit integer DEFAULT 500,
  run_id uuid DEFAULT gen_random_uuid()
)
RETURNS TABLE(blast_id uuid, reaped_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(mins => GREATEST(max_age_minutes, 1));
  v_limit  integer     := LEAST(GREATEST(batch_limit, 1), 5000);
  v_run    uuid        := COALESCE(run_id, gen_random_uuid());
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT i.id, i.blast_id, i.tenant_id, i.claimed_at AS prev_claimed_at
    FROM public.sms_blast_items AS i
    WHERE i.status = 'claimed'
      AND i.claimed_at IS NOT NULL
      AND i.claimed_at < v_cutoff
      AND i.telnyx_message_id IS NULL
      AND i.sent_at IS NULL
      AND i.delivered_at IS NULL
    ORDER BY i.claimed_at ASC
    LIMIT v_limit
    FOR UPDATE OF i SKIP LOCKED
  ),
  updated AS (
    UPDATE public.sms_blast_items AS i
    SET status      = 'pending',
        claimed_at  = NULL,
        last_error  = COALESCE(NULLIF(i.last_error, '') || ' | ', '')
                      || 'reaped: stuck claimed >' || max_age_minutes || 'm',
        updated_at  = now()
    FROM candidates c
    WHERE i.id = c.id
    RETURNING i.id, i.blast_id, i.tenant_id
  ),
  audit_rows AS (
    INSERT INTO public.sms_claim_reap_events (
      item_id, blast_id, tenant_id,
      previous_status, new_status,
      previous_claimed_at, reason, run_id
    )
    SELECT u.id, u.blast_id, u.tenant_id,
           'claimed', 'pending',
           c.prev_claimed_at,
           'reaped: stuck claimed >' || max_age_minutes || 'm',
           v_run
    FROM updated u
    JOIN candidates c ON c.id = u.id
    RETURNING blast_id
  )
  SELECT ar.blast_id, COUNT(*)::bigint AS reaped_count
  FROM audit_rows ar
  GROUP BY ar.blast_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stale_sms_claims(integer, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stale_sms_claims(integer, integer, uuid) TO authenticated, service_role;
