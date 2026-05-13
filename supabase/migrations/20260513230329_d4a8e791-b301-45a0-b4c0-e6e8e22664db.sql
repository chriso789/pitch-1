
-- Trigger: when a job linked to a referral_conversion reaches sold/paid/completed,
-- create a referral_rewards row in 'eligible' status (idempotent per conversion).

CREATE OR REPLACE FUNCTION public.fn_referral_reward_on_job_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv RECORD;
  v_code RECORD;
  v_existing uuid;
BEGIN
  IF NEW.status IS NULL THEN
    RETURN NEW;
  END IF;

  IF lower(NEW.status) NOT IN ('sold', 'paid', 'completed') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Find any conversion tied to this job
  FOR v_conv IN
    SELECT * FROM public.referral_conversions WHERE job_id = NEW.id
  LOOP
    -- Skip if reward already exists for this conversion
    SELECT id INTO v_existing
    FROM public.referral_rewards
    WHERE referral_conversion_id = v_conv.id
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_code
    FROM public.referral_codes
    WHERE id = v_conv.referral_code_id;

    INSERT INTO public.referral_rewards (
      tenant_id,
      referral_conversion_id,
      recipient_contact_id,
      reward_type,
      reward_value,
      status,
      notes
    ) VALUES (
      v_conv.tenant_id,
      v_conv.id,
      v_conv.referrer_contact_id,
      COALESCE(v_code.reward_type, 'cash'),
      COALESCE(v_code.reward_value, 0),
      'eligible',
      'Auto-created when job status changed to ' || NEW.status
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_reward_on_job_status ON public.jobs;
CREATE TRIGGER trg_referral_reward_on_job_status
AFTER INSERT OR UPDATE OF status ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.fn_referral_reward_on_job_status();
