
-- 1) Add 'failed' to srs_orders.status check constraint (queued/accepted/rejected_by_srs already allowed).
ALTER TABLE public.srs_orders DROP CONSTRAINT IF EXISTS srs_orders_status_check;
ALTER TABLE public.srs_orders ADD CONSTRAINT srs_orders_status_check
  CHECK (status = ANY (ARRAY[
    'draft','queued','submitted','accepted','confirmed','processing',
    'shipped','delivered','cancelled','error','failed','rejected_by_srs'
  ]));

-- 2) Flip default branch from SRORL to SRFTL on existing SRS connections (Jessica's STG sample uses SRFTL),
--    clear the placeholder jobAccountNumber=1, and force re-validate.
UPDATE public.srs_connections
SET default_branch_code = 'SRFTL',
    job_account_number  = NULL,
    valid_indicator     = false,
    connection_status   = 'disconnected',
    access_token        = NULL,
    token_expires_at    = NULL
WHERE default_branch_code = 'SRORL' OR job_account_number = 1;
