
ALTER TABLE public.referral_codes
  ADD COLUMN IF NOT EXISTS source_job_id uuid,
  ADD COLUMN IF NOT EXISTS landing_headline text,
  ADD COLUMN IF NOT EXISTS landing_message text,
  ADD COLUMN IF NOT EXISTS landing_hero_image_url text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'
    CHECK (status IN ('active','paused','expired','revoked'));

CREATE INDEX IF NOT EXISTS idx_referral_codes_code_active
  ON public.referral_codes(code) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.referral_program_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT true,
  default_reward_type text NOT NULL DEFAULT 'fixed_amount'
    CHECK (default_reward_type IN ('fixed_amount','percentage_of_collected_revenue','manual')),
  fixed_reward_amount numeric NOT NULL DEFAULT 250,
  percentage_reward_rate numeric NOT NULL DEFAULT 2.0,
  minimum_collected_revenue numeric NOT NULL DEFAULT 0,
  payout_trigger text NOT NULL DEFAULT 'job_paid'
    CHECK (payout_trigger IN ('lead_submitted','appointment_completed','job_sold','job_paid','job_completed')),
  allow_stored_balance boolean NOT NULL DEFAULT true,
  allow_venmo boolean NOT NULL DEFAULT true,
  allow_zelle boolean NOT NULL DEFAULT true,
  allow_gift_card boolean NOT NULL DEFAULT false,
  require_admin_approval boolean NOT NULL DEFAULT true,
  max_rewards_per_referrer_per_year int,
  duplicate_window_days int NOT NULL DEFAULT 180,
  block_self_referrals boolean NOT NULL DEFAULT true,
  terms_text text DEFAULT 'Referral rewards are paid after the referred job is fully paid. One referral per household per 180 days. Rewards may be reported to the IRS as 1099 income above $600/year.',
  default_landing_headline text DEFAULT 'A friend trusted us with their roof — we''d love to help you too.',
  default_landing_message text,
  brand_primary_color text DEFAULT '#1e40af',
  hero_image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  referral_link_id uuid REFERENCES public.referral_codes(id) ON DELETE SET NULL,
  referrer_contact_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'page_view','click_call_button','click_text_button','click_email_button',
    'click_start_form','form_submit','payout_choice_started','payout_choice_saved',
    'duplicate_submission','suspicious_activity','admin_status_change'
  )),
  event_source text,
  session_id text,
  visitor_id text,
  ip_hash text,
  user_agent text,
  device_type text,
  browser text,
  os text,
  city text,
  region text,
  country text,
  landing_url text,
  referrer_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  gclid text,
  msclkid text,
  ttclid text,
  ref_channel text,
  sent_by_user_id uuid,
  campaign_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_events_tenant_created
  ON public.referral_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_events_link
  ON public.referral_events(referral_link_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_events_visitor
  ON public.referral_events(visitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.referral_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  referral_link_id uuid REFERENCES public.referral_codes(id) ON DELETE SET NULL,
  referrer_contact_id uuid,
  source_job_id uuid,
  referred_first_name text NOT NULL,
  referred_last_name text NOT NULL,
  referred_email text,
  referred_phone text NOT NULL,
  referred_property_address text,
  referred_city text,
  referred_state text,
  referred_zip text,
  project_type text,
  roof_type_interest text,
  service_needed text,
  message text,
  preferred_contact_method text DEFAULT 'phone'
    CHECK (preferred_contact_method IN ('phone','text','email')),
  consent_to_contact boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','appointment_set','estimate_sent','sold','completed','rejected','duplicate','invalid')),
  crm_lead_id uuid,
  crm_contact_id uuid,
  crm_job_id uuid,
  estimated_value numeric,
  sold_value numeric,
  payout_eligible boolean NOT NULL DEFAULT false,
  payout_eligibility_reason text,
  ip_hash text,
  user_agent text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_submissions_tenant_status
  ON public.referral_submissions(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_submissions_link
  ON public.referral_submissions(referral_link_id);
CREATE INDEX IF NOT EXISTS idx_referral_submissions_phone
  ON public.referral_submissions(tenant_id, referred_phone);

CREATE TABLE IF NOT EXISTS public.referrer_payout_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  referrer_contact_id uuid NOT NULL,
  preferred_payout_method text
    CHECK (preferred_payout_method IN ('venmo','zelle','gift_card','stored_balance')),
  venmo_handle text,
  zelle_email text,
  zelle_phone text,
  gift_card_email text,
  stored_balance_enabled boolean DEFAULT false,
  tax_acknowledgment boolean DEFAULT false,
  payout_terms_accepted boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, referrer_contact_id)
);

CREATE TABLE IF NOT EXISTS public.referral_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  referral_submission_id uuid REFERENCES public.referral_submissions(id) ON DELETE SET NULL,
  referral_link_id uuid REFERENCES public.referral_codes(id) ON DELETE SET NULL,
  referrer_contact_id uuid NOT NULL,
  payout_method text NOT NULL
    CHECK (payout_method IN ('venmo','zelle','gift_card','stored_balance','manual')),
  payout_amount numeric NOT NULL,
  payout_status text NOT NULL DEFAULT 'pending'
    CHECK (payout_status IN ('pending','approved','paid','rejected','cancelled','stored_as_credit')),
  approval_user_id uuid,
  approved_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_tenant_status
  ON public.referral_payouts(tenant_id, payout_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_referrer
  ON public.referral_payouts(tenant_id, referrer_contact_id);

CREATE TABLE IF NOT EXISTS public.referral_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  referrer_contact_id uuid NOT NULL,
  referral_payout_id uuid REFERENCES public.referral_payouts(id) ON DELETE SET NULL,
  transaction_type text NOT NULL
    CHECK (transaction_type IN ('credit_earned','credit_used','credit_adjustment','credit_expired')),
  amount numeric NOT NULL,
  balance_after numeric NOT NULL DEFAULT 0,
  related_job_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_referrer
  ON public.referral_credit_ledger(tenant_id, referrer_contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.referral_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  referral_submission_id uuid REFERENCES public.referral_submissions(id) ON DELETE SET NULL,
  referral_link_id uuid REFERENCES public.referral_codes(id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.referral_events(id) ON DELETE SET NULL,
  flag_type text NOT NULL CHECK (flag_type IN (
    'duplicate_phone','duplicate_email','self_referral','repeated_ip_hash',
    'suspicious_click_velocity','blocked_domain','manual_review'
  )),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  description text,
  resolved boolean DEFAULT false,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_flags_tenant_unresolved
  ON public.referral_flags(tenant_id, resolved, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at_referrals() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $f$
BEGIN NEW.updated_at = now(); RETURN NEW; END $f$;

DROP TRIGGER IF EXISTS trg_settings_uat ON public.referral_program_settings;
CREATE TRIGGER trg_settings_uat BEFORE UPDATE ON public.referral_program_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_referrals();

DROP TRIGGER IF EXISTS trg_subs_uat ON public.referral_submissions;
CREATE TRIGGER trg_subs_uat BEFORE UPDATE ON public.referral_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_referrals();

DROP TRIGGER IF EXISTS trg_payprof_uat ON public.referrer_payout_profiles;
CREATE TRIGGER trg_payprof_uat BEFORE UPDATE ON public.referrer_payout_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_referrals();

DROP TRIGGER IF EXISTS trg_payouts_uat ON public.referral_payouts;
CREATE TRIGGER trg_payouts_uat BEFORE UPDATE ON public.referral_payouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_referrals();

CREATE OR REPLACE FUNCTION public.generate_referral_code(_tenant_id uuid, _contact_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _first text;
  _suffix text;
  _candidate text;
  _attempt int := 0;
BEGIN
  SELECT upper(regexp_replace(coalesce(first_name, 'FRIEND'), '[^A-Za-z]', '', 'g'))
    INTO _first
  FROM public.contacts WHERE id = _contact_id;
  _first := coalesce(nullif(_first, ''), 'FRIEND');
  IF length(_first) > 10 THEN _first := substring(_first, 1, 10); END IF;

  LOOP
    _suffix := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
    _candidate := 'OBR-' || _first || '-' || _suffix;
    IF NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE code = _candidate) THEN
      RETURN _candidate;
    END IF;
    _attempt := _attempt + 1;
    IF _attempt > 10 THEN
      RETURN 'OBR-' || _suffix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.calculate_referral_reward(_tenant_id uuid, _submission_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _settings public.referral_program_settings%ROWTYPE;
  _sub public.referral_submissions%ROWTYPE;
  _reward numeric := 0;
BEGIN
  SELECT * INTO _settings FROM public.referral_program_settings WHERE tenant_id = _tenant_id;
  SELECT * INTO _sub FROM public.referral_submissions WHERE id = _submission_id AND tenant_id = _tenant_id;
  IF NOT FOUND OR _settings.id IS NULL THEN RETURN 0; END IF;

  IF _settings.default_reward_type = 'fixed_amount' THEN
    _reward := _settings.fixed_reward_amount;
  ELSIF _settings.default_reward_type = 'percentage_of_collected_revenue' THEN
    IF coalesce(_sub.sold_value, 0) >= coalesce(_settings.minimum_collected_revenue, 0) THEN
      _reward := round(coalesce(_sub.sold_value, 0) * (_settings.percentage_reward_rate / 100.0), 2);
    END IF;
  END IF;
  RETURN _reward;
END $$;

CREATE OR REPLACE FUNCTION public.get_referrer_credit_balance(_tenant_id uuid, _contact_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT balance_after FROM public.referral_credit_ledger
       WHERE tenant_id = _tenant_id AND referrer_contact_id = _contact_id
       ORDER BY created_at DESC, id DESC LIMIT 1),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.fill_credit_balance_after()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _prev numeric := 0;
  _delta numeric := 0;
BEGIN
  SELECT coalesce(balance_after, 0) INTO _prev
  FROM public.referral_credit_ledger
  WHERE tenant_id = NEW.tenant_id
    AND referrer_contact_id = NEW.referrer_contact_id
  ORDER BY created_at DESC, id DESC LIMIT 1;

  IF NEW.transaction_type IN ('credit_earned','credit_adjustment') THEN
    _delta := coalesce(NEW.amount, 0);
  ELSIF NEW.transaction_type IN ('credit_used','credit_expired') THEN
    _delta := -1 * abs(coalesce(NEW.amount, 0));
  END IF;
  NEW.balance_after := coalesce(_prev, 0) + _delta;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_credit_balance_fill ON public.referral_credit_ledger;
CREATE TRIGGER trg_credit_balance_fill
  BEFORE INSERT ON public.referral_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.fill_credit_balance_after();

CREATE OR REPLACE FUNCTION public.get_public_referral_link(_code text)
RETURNS TABLE (
  referral_link_id uuid,
  tenant_id uuid,
  code text,
  referrer_first_name text,
  referrer_last_name text,
  landing_headline text,
  landing_message text,
  landing_hero_image_url text,
  brand_primary_color text,
  hero_image_url text,
  is_active boolean,
  status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    rc.id,
    rc.tenant_id,
    rc.code,
    c.first_name,
    c.last_name,
    coalesce(rc.landing_headline, s.default_landing_headline),
    coalesce(rc.landing_message, s.default_landing_message),
    coalesce(rc.landing_hero_image_url, s.hero_image_url),
    s.brand_primary_color,
    s.hero_image_url,
    rc.is_active,
    rc.status
  FROM public.referral_codes rc
  LEFT JOIN public.contacts c ON c.id = rc.customer_id
  LEFT JOIN public.referral_program_settings s ON s.tenant_id = rc.tenant_id
  WHERE rc.code = _code
    AND rc.is_active = true
    AND coalesce(rc.status, 'active') = 'active'
    AND (rc.expires_at IS NULL OR rc.expires_at > now());
$$;

CREATE OR REPLACE FUNCTION public.submit_public_referral(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _link public.referral_codes%ROWTYPE;
  _sub_id uuid;
  _is_dup boolean := false;
  _settings public.referral_program_settings%ROWTYPE;
BEGIN
  SELECT * INTO _link FROM public.referral_codes
   WHERE code = _payload->>'code' AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  SELECT * INTO _settings FROM public.referral_program_settings WHERE tenant_id = _link.tenant_id;

  IF coalesce((_payload->>'consent_to_contact')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'consent_required');
  END IF;

  IF _settings.duplicate_window_days IS NOT NULL AND _payload ? 'referred_phone' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.referral_submissions
      WHERE tenant_id = _link.tenant_id
        AND referred_phone = _payload->>'referred_phone'
        AND created_at > now() - (_settings.duplicate_window_days || ' days')::interval
    ) INTO _is_dup;
  END IF;

  INSERT INTO public.referral_submissions (
    tenant_id, referral_link_id, referrer_contact_id, source_job_id,
    referred_first_name, referred_last_name, referred_email, referred_phone,
    referred_property_address, referred_city, referred_state, referred_zip,
    project_type, roof_type_interest, service_needed, message,
    preferred_contact_method, consent_to_contact,
    status, ip_hash, user_agent, utm_source, utm_medium, utm_campaign, metadata
  ) VALUES (
    _link.tenant_id, _link.id, _link.customer_id, _link.source_job_id,
    _payload->>'referred_first_name', _payload->>'referred_last_name',
    nullif(_payload->>'referred_email',''), _payload->>'referred_phone',
    nullif(_payload->>'referred_property_address',''), nullif(_payload->>'referred_city',''),
    nullif(_payload->>'referred_state',''), nullif(_payload->>'referred_zip',''),
    nullif(_payload->>'project_type',''), nullif(_payload->>'roof_type_interest',''),
    nullif(_payload->>'service_needed',''), nullif(_payload->>'message',''),
    coalesce(nullif(_payload->>'preferred_contact_method',''), 'phone'),
    coalesce((_payload->>'consent_to_contact')::boolean, false),
    CASE WHEN _is_dup THEN 'duplicate' ELSE 'new' END,
    nullif(_payload->>'ip_hash',''), nullif(_payload->>'user_agent',''),
    nullif(_payload->>'utm_source',''), nullif(_payload->>'utm_medium',''),
    nullif(_payload->>'utm_campaign',''),
    coalesce(_payload->'metadata', '{}'::jsonb)
  ) RETURNING id INTO _sub_id;

  IF _is_dup THEN
    INSERT INTO public.referral_flags (tenant_id, referral_submission_id, referral_link_id, flag_type, severity, description)
    VALUES (_link.tenant_id, _sub_id, _link.id, 'duplicate_phone', 'medium',
      'Phone matched a prior submission within the duplicate window');
  END IF;

  UPDATE public.referral_codes
     SET current_uses = coalesce(current_uses, 0) + 1, updated_at = now()
   WHERE id = _link.id;

  RETURN jsonb_build_object('ok', true, 'submission_id', _sub_id, 'duplicate', _is_dup);
END $$;

CREATE OR REPLACE FUNCTION public.track_public_referral_event(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _link public.referral_codes%ROWTYPE;
  _id uuid;
BEGIN
  SELECT * INTO _link FROM public.referral_codes WHERE code = _payload->>'code';
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.referral_events (
    tenant_id, referral_link_id, referrer_contact_id, event_type, event_source,
    session_id, visitor_id, ip_hash, user_agent, device_type, browser, os,
    city, region, country, landing_url, referrer_url,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, gclid, msclkid, ttclid, ref_channel, metadata
  ) VALUES (
    _link.tenant_id, _link.id, _link.customer_id,
    coalesce(nullif(_payload->>'event_type',''), 'page_view'),
    nullif(_payload->>'event_source',''),
    nullif(_payload->>'session_id',''), nullif(_payload->>'visitor_id',''),
    nullif(_payload->>'ip_hash',''), nullif(_payload->>'user_agent',''),
    nullif(_payload->>'device_type',''), nullif(_payload->>'browser',''), nullif(_payload->>'os',''),
    nullif(_payload->>'city',''), nullif(_payload->>'region',''), nullif(_payload->>'country',''),
    nullif(_payload->>'landing_url',''), nullif(_payload->>'referrer_url',''),
    nullif(_payload->>'utm_source',''), nullif(_payload->>'utm_medium',''),
    nullif(_payload->>'utm_campaign',''), nullif(_payload->>'utm_content',''), nullif(_payload->>'utm_term',''),
    nullif(_payload->>'fbclid',''), nullif(_payload->>'gclid',''), nullif(_payload->>'msclkid',''), nullif(_payload->>'ttclid',''),
    nullif(_payload->>'ref_channel',''),
    coalesce(_payload->'metadata', '{}'::jsonb)
  ) RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.save_referrer_payout_preference(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _link public.referral_codes%ROWTYPE;
BEGIN
  SELECT * INTO _link FROM public.referral_codes WHERE code = _payload->>'code' AND is_active = true;
  IF NOT FOUND OR _link.customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;

  INSERT INTO public.referrer_payout_profiles (
    tenant_id, referrer_contact_id, preferred_payout_method,
    venmo_handle, zelle_email, zelle_phone, gift_card_email,
    stored_balance_enabled, tax_acknowledgment, payout_terms_accepted
  ) VALUES (
    _link.tenant_id, _link.customer_id,
    nullif(_payload->>'preferred_payout_method',''),
    nullif(_payload->>'venmo_handle',''),
    nullif(_payload->>'zelle_email',''),
    nullif(_payload->>'zelle_phone',''),
    nullif(_payload->>'gift_card_email',''),
    coalesce((_payload->>'stored_balance_enabled')::boolean, false),
    coalesce((_payload->>'tax_acknowledgment')::boolean, false),
    coalesce((_payload->>'payout_terms_accepted')::boolean, false)
  )
  ON CONFLICT (tenant_id, referrer_contact_id) DO UPDATE SET
    preferred_payout_method = EXCLUDED.preferred_payout_method,
    venmo_handle = EXCLUDED.venmo_handle,
    zelle_email = EXCLUDED.zelle_email,
    zelle_phone = EXCLUDED.zelle_phone,
    gift_card_email = EXCLUDED.gift_card_email,
    stored_balance_enabled = EXCLUDED.stored_balance_enabled,
    tax_acknowledgment = EXCLUDED.tax_acknowledgment,
    payout_terms_accepted = EXCLUDED.payout_terms_accepted,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END $$;

ALTER TABLE public.referral_program_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_submissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrer_payout_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_payouts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_credit_ledger    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_flags            ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE _tbl text; BEGIN
  FOREACH _tbl IN ARRAY ARRAY[
    'referral_program_settings','referral_events','referral_submissions',
    'referrer_payout_profiles','referral_payouts','referral_credit_ledger','referral_flags'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_tenant_all" ON public.%I', _tbl, _tbl);
    EXECUTE format($p$
      CREATE POLICY "%1$s_tenant_all" ON public.%1$I
        FOR ALL TO authenticated
        USING (tenant_id = public.get_user_tenant_id())
        WITH CHECK (tenant_id = public.get_user_tenant_id())
    $p$, _tbl);
  END LOOP;
END $$;

REVOKE ALL ON public.referral_events, public.referral_submissions,
              public.referrer_payout_profiles, public.referral_payouts,
              public.referral_credit_ledger, public.referral_flags,
              public.referral_program_settings FROM anon;

GRANT EXECUTE ON FUNCTION public.get_public_referral_link(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_referral(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_public_referral_event(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_referrer_payout_preference(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_referral_code(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_referral_reward(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_referrer_credit_balance(uuid, uuid) TO authenticated;

INSERT INTO public.referral_program_settings (tenant_id)
SELECT DISTINCT t.id FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.referral_program_settings s WHERE s.tenant_id = t.id);

CREATE OR REPLACE FUNCTION public.seed_referral_settings_for_new_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.referral_program_settings (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_referral_settings ON public.tenants;
CREATE TRIGGER trg_seed_referral_settings
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_referral_settings_for_new_tenant();
