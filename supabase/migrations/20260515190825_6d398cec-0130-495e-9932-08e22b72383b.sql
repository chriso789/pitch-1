
DROP FUNCTION IF EXISTS public.get_referrer_credit_balance(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_referrer_rewards_paid_this_year(uuid, uuid);
DROP FUNCTION IF EXISTS public.referral_submission_has_blocking_flags(uuid);
DROP FUNCTION IF EXISTS public.calculate_referral_reward(uuid, uuid);

ALTER TABLE public.referral_submissions
  ADD COLUMN IF NOT EXISTS collected_revenue numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sold_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS appointment_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_override_eligible boolean,
  ADD COLUMN IF NOT EXISTS admin_override_reason text;

ALTER TABLE public.referral_program_settings
  ADD COLUMN IF NOT EXISTS reward_expiration_days integer,
  ADD COLUMN IF NOT EXISTS minimum_days_before_payout integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS block_existing_customers boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS block_existing_leads_in_duplicate_window boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_referral_submissions_crm_lead_id
  ON public.referral_submissions(crm_lead_id) WHERE crm_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referral_submissions_crm_job_id
  ON public.referral_submissions(crm_job_id) WHERE crm_job_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_referrer_credit_balance(
  _tenant_id uuid,
  _referrer_contact_id uuid
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT balance_after
     FROM public.referral_credit_ledger
     WHERE tenant_id = _tenant_id
       AND referrer_contact_id = _referrer_contact_id
     ORDER BY created_at DESC
     LIMIT 1),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.get_referrer_rewards_paid_this_year(
  _tenant_id uuid,
  _referrer_contact_id uuid
) RETURNS TABLE(reward_count integer, reward_amount numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(payout_amount), 0)::numeric
  FROM public.referral_payouts
  WHERE tenant_id = _tenant_id
    AND referrer_contact_id = _referrer_contact_id
    AND payout_status IN ('approved', 'paid', 'stored_as_credit')
    AND created_at >= date_trunc('year', now());
$$;

CREATE OR REPLACE FUNCTION public.referral_submission_has_blocking_flags(
  _referral_submission_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.referral_flags
    WHERE referral_submission_id = _referral_submission_id
      AND resolved = false
      AND severity IN ('high', 'critical')
  );
$$;

CREATE OR REPLACE FUNCTION public.calculate_referral_reward(
  _tenant_id uuid,
  _referral_submission_id uuid
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.referral_program_settings%ROWTYPE;
  sub public.referral_submissions%ROWTYPE;
  amt numeric;
BEGIN
  SELECT * INTO s FROM public.referral_program_settings WHERE tenant_id = _tenant_id LIMIT 1;
  SELECT * INTO sub FROM public.referral_submissions WHERE id = _referral_submission_id;

  IF s.id IS NULL OR sub.id IS NULL THEN RETURN NULL; END IF;

  IF s.default_reward_type = 'fixed_amount' THEN
    amt := COALESCE(s.fixed_reward_amount, 0);
  ELSIF s.default_reward_type = 'percentage_of_collected_revenue' THEN
    amt := ROUND(COALESCE(sub.collected_revenue, 0) * COALESCE(s.percentage_reward_rate, 0) / 100.0, 2);
  ELSE
    amt := NULL;
  END IF;

  RETURN amt;
END;
$$;
