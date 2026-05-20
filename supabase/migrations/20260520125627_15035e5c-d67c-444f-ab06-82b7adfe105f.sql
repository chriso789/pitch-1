CREATE OR REPLACE FUNCTION public.fn_referral_reward_on_job_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_conv RECORD;
  v_code RECORD;
  v_existing uuid;
  v_status text;
BEGIN
  v_status := NEW.status::text;

  IF v_status IS NULL THEN
    RETURN NEW;
  END IF;

  IF lower(v_status) NOT IN ('sold', 'paid', 'completed') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  FOR v_conv IN
    SELECT * FROM public.referral_conversions WHERE job_id = NEW.id
  LOOP
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
      'Auto-created when job status changed to ' || v_status
    );
  END LOOP;

  RETURN NEW;
END;
$$;