
-- Repair #2: Telnyx rate-limit backoff + claim release

ALTER TABLE public.sms_blast_items
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by uuid,
  ADD COLUMN IF NOT EXISTS provider_error_code text,
  ADD COLUMN IF NOT EXISTS provider_request_id text;

CREATE INDEX IF NOT EXISTS idx_sms_blast_items_pending_next_attempt
  ON public.sms_blast_items (blast_id, next_attempt_at)
  WHERE status = 'pending';

-- Immutable audit trail for rate-limit releases
CREATE TABLE IF NOT EXISTS public.sms_rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  blast_id uuid NOT NULL,
  tenant_id uuid,
  previous_status text NOT NULL,
  new_status text NOT NULL,
  attempt_count integer,
  retry_after_ms integer,
  next_attempt_at timestamptz,
  provider_error_code text,
  provider_error_message text,
  provider_request_id text,
  processor_run_id uuid,
  claimed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sms_rate_limit_events TO authenticated;
GRANT ALL ON public.sms_rate_limit_events TO service_role;

ALTER TABLE public.sms_rate_limit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_limit_events_master_read" ON public.sms_rate_limit_events;
CREATE POLICY "rate_limit_events_master_read"
  ON public.sms_rate_limit_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role));

CREATE INDEX IF NOT EXISTS idx_sms_rate_limit_events_blast
  ON public.sms_rate_limit_events(blast_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_rate_limit_events_item
  ON public.sms_rate_limit_events(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_rate_limit_events_run
  ON public.sms_rate_limit_events(processor_run_id);

-- Extended claim function: same semantics + honors next_attempt_at + records claim owner.
-- attempt_count still increments exactly once per claim, which corresponds to one
-- provider send attempt in this codebase. The reaper and the rate-limit release
-- both leave attempt_count untouched, so a single rate-limited send counts once.
DROP FUNCTION IF EXISTS public.claim_sms_blast_items(uuid, integer);
DROP FUNCTION IF EXISTS public.claim_sms_blast_items(uuid, integer, uuid);
CREATE OR REPLACE FUNCTION public.claim_sms_blast_items(
  p_blast_id uuid,
  p_limit integer,
  p_claim_token uuid DEFAULT NULL
)
RETURNS SETOF public.sms_blast_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_token uuid := COALESCE(p_claim_token, gen_random_uuid());
BEGIN
  RETURN QUERY
  UPDATE public.sms_blast_items i
     SET status = 'claimed',
         claimed_at = now(),
         claimed_by = v_token,
         attempt_count = COALESCE(i.attempt_count, 0) + 1,
         updated_at = now()
   WHERE i.id IN (
     SELECT id FROM public.sms_blast_items
      WHERE blast_id = p_blast_id
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        AND (
          status = 'pending'
          OR (
            status = 'claimed'
            AND sent_at IS NULL
            AND telnyx_message_id IS NULL
            AND claimed_at < now() - interval '5 minutes'
          )
        )
      ORDER BY COALESCE(next_attempt_at, updated_at), id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING i.*;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_sms_blast_items(uuid, integer, uuid) TO service_role;

-- Conditional release back to pending after a confirmed retryable rate-limit response.
-- Refuses to release if:
--   * the row is no longer claimed
--   * a different worker owns the claim
--   * Telnyx returned a message id (row must go through the sent/reconciliation path)
-- Never changes attempt_count. Always writes an audit event on success.
CREATE OR REPLACE FUNCTION public.release_sms_blast_item_rate_limited(
  p_item_id uuid,
  p_claim_token uuid,
  p_next_attempt_at timestamptz,
  p_last_error text,
  p_provider_error_code text DEFAULT NULL,
  p_provider_request_id text DEFAULT NULL,
  p_retry_after_ms integer DEFAULT NULL,
  p_processor_run_id uuid DEFAULT NULL
)
RETURNS TABLE(released boolean, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.sms_blast_items%ROWTYPE;
BEGIN
  IF p_claim_token IS NULL THEN
    RETURN QUERY SELECT false, NULL::integer;
    RETURN;
  END IF;

  UPDATE public.sms_blast_items
     SET status = 'pending',
         claimed_at = NULL,
         claimed_by = NULL,
         next_attempt_at = p_next_attempt_at,
         last_error = LEFT(COALESCE(p_last_error, 'rate_limited'), 500),
         error_message = LEFT(COALESCE(p_last_error, 'rate_limited'), 500),
         provider_error_code = p_provider_error_code,
         provider_request_id = p_provider_request_id,
         updated_at = now()
   WHERE id = p_item_id
     AND status = 'claimed'
     AND claimed_by = p_claim_token
     AND telnyx_message_id IS NULL
     AND sent_at IS NULL
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::integer;
    RETURN;
  END IF;

  INSERT INTO public.sms_rate_limit_events (
    item_id, blast_id, tenant_id, previous_status, new_status,
    attempt_count, retry_after_ms, next_attempt_at,
    provider_error_code, provider_error_message, provider_request_id,
    processor_run_id, claimed_by
  ) VALUES (
    v_row.id, v_row.blast_id, v_row.tenant_id, 'claimed', 'pending',
    v_row.attempt_count, p_retry_after_ms, p_next_attempt_at,
    p_provider_error_code, LEFT(COALESCE(p_last_error, 'rate_limited'), 500), p_provider_request_id,
    p_processor_run_id, p_claim_token
  );

  RETURN QUERY SELECT true, v_row.attempt_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.release_sms_blast_item_rate_limited(uuid, uuid, timestamptz, text, text, text, integer, uuid) TO service_role;
