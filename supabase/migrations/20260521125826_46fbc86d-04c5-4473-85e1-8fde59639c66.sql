
-- ===== Helper: program-admin check (owner/admin tier) =====
CREATE OR REPLACE FUNCTION public.is_crm_referral_admin(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.user_can_access_tenant(_tenant_id) AND public.has_high_level_role(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_crm_referral_manager(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.user_can_access_tenant(_tenant_id) AND public.has_manager_role(auth.uid());
$$;

-- ===== Enable RLS on all 10 tables =====
ALTER TABLE public.crm_referral_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_referral_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_referral_signup_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_referral_company_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_referral_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_referral_payout_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_referral_program_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_referral_account_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_referral_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_referral_status_history ENABLE ROW LEVEL SECURITY;

-- ===== Partners =====
CREATE POLICY "crm_partners_select" ON public.crm_referral_partners
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));
CREATE POLICY "crm_partners_write" ON public.crm_referral_partners
  FOR ALL USING (public.is_crm_referral_manager(tenant_id))
  WITH CHECK (public.is_crm_referral_manager(tenant_id));

-- ===== Links =====
CREATE POLICY "crm_links_select" ON public.crm_referral_links
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));
CREATE POLICY "crm_links_write" ON public.crm_referral_links
  FOR ALL USING (public.is_crm_referral_manager(tenant_id))
  WITH CHECK (public.is_crm_referral_manager(tenant_id));

-- ===== Signup events (server-only writes via edge fn) =====
CREATE POLICY "crm_signup_events_select" ON public.crm_referral_signup_events
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));

-- ===== Company signups =====
CREATE POLICY "crm_company_signups_select" ON public.crm_referral_company_signups
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));
CREATE POLICY "crm_company_signups_write" ON public.crm_referral_company_signups
  FOR ALL USING (public.is_crm_referral_manager(tenant_id))
  WITH CHECK (public.is_crm_referral_manager(tenant_id));

-- ===== Payouts (admin only) =====
CREATE POLICY "crm_payouts_select" ON public.crm_referral_payouts
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));
CREATE POLICY "crm_payouts_write" ON public.crm_referral_payouts
  FOR ALL USING (public.is_crm_referral_admin(tenant_id))
  WITH CHECK (public.is_crm_referral_admin(tenant_id));

-- ===== Payout profiles (admin only — banking info) =====
CREATE POLICY "crm_payout_profiles_select" ON public.crm_referral_payout_profiles
  FOR SELECT USING (public.is_crm_referral_admin(tenant_id));
CREATE POLICY "crm_payout_profiles_write" ON public.crm_referral_payout_profiles
  FOR ALL USING (public.is_crm_referral_admin(tenant_id))
  WITH CHECK (public.is_crm_referral_admin(tenant_id));

-- ===== Program settings (admin only writes) =====
CREATE POLICY "crm_settings_select" ON public.crm_referral_program_settings
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));
CREATE POLICY "crm_settings_write" ON public.crm_referral_program_settings
  FOR ALL USING (public.is_crm_referral_admin(tenant_id))
  WITH CHECK (public.is_crm_referral_admin(tenant_id));

-- ===== Credit ledger (admin only writes) =====
CREATE POLICY "crm_credit_select" ON public.crm_referral_account_credit_ledger
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));
CREATE POLICY "crm_credit_write" ON public.crm_referral_account_credit_ledger
  FOR ALL USING (public.is_crm_referral_admin(tenant_id))
  WITH CHECK (public.is_crm_referral_admin(tenant_id));

-- ===== Flags =====
CREATE POLICY "crm_flags_select" ON public.crm_referral_flags
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));
CREATE POLICY "crm_flags_write" ON public.crm_referral_flags
  FOR ALL USING (public.is_crm_referral_manager(tenant_id))
  WITH CHECK (public.is_crm_referral_manager(tenant_id));

-- ===== Status history =====
CREATE POLICY "crm_status_history_select" ON public.crm_referral_status_history
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));

-- ===== Public landing-page RPC =====
CREATE OR REPLACE FUNCTION public.get_public_crm_referral_link(_code text)
RETURNS TABLE (
  link_id uuid,
  partner_id uuid,
  partner_code text,
  partner_display_name text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  landing_page text,
  is_active boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, p.id, p.partner_code,
         COALESCE(p.company_name, p.partner_name) AS partner_display_name,
         l.utm_source, l.utm_medium, l.utm_campaign,
         l.landing_page, (l.is_active AND p.status = 'active')
  FROM public.crm_referral_links l
  JOIN public.crm_referral_partners p ON p.id = l.partner_id
  WHERE (l.link_code = _code OR p.partner_code = _code)
  ORDER BY (l.link_code = _code) DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_crm_referral_link(text) TO anon, authenticated;

-- ===== Status-history trigger =====
CREATE OR REPLACE FUNCTION public.crm_referral_signup_status_history_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.crm_referral_status_history
      (tenant_id, partner_id, signup_id, entity_type, old_status, new_status, changed_by, change_reason)
    VALUES (NEW.tenant_id, NEW.partner_id, NEW.id, 'company_signup', NULL, NEW.signup_status::text, auth.uid(), 'created');
  ELSIF NEW.signup_status IS DISTINCT FROM OLD.signup_status THEN
    INSERT INTO public.crm_referral_status_history
      (tenant_id, partner_id, signup_id, entity_type, old_status, new_status, changed_by, change_reason)
    VALUES (NEW.tenant_id, NEW.partner_id, NEW.id, 'company_signup',
            OLD.signup_status::text, NEW.signup_status::text, auth.uid(), 'status_change');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_referral_signup_status_history ON public.crm_referral_company_signups;
CREATE TRIGGER crm_referral_signup_status_history
AFTER INSERT OR UPDATE OF signup_status ON public.crm_referral_company_signups
FOR EACH ROW EXECUTE FUNCTION public.crm_referral_signup_status_history_trg();

-- ===== Eligibility auto-flip trigger =====
CREATE OR REPLACE FUNCTION public.crm_referral_signup_eligibility_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.crm_referral_program_settings%ROWTYPE;
BEGIN
  IF NEW.payout_eligible THEN RETURN NEW; END IF;
  IF NEW.fraud_flag THEN RETURN NEW; END IF;

  SELECT * INTO s FROM public.crm_referral_program_settings WHERE tenant_id = NEW.tenant_id LIMIT 1;
  IF NOT FOUND OR NOT s.program_enabled THEN RETURN NEW; END IF;

  IF NEW.signup_status::text IN ('paid','active') AND NEW.paid_at IS NOT NULL THEN
    NEW.payout_eligible := true;
    NEW.payout_eligible_at := COALESCE(NEW.payout_eligible_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_referral_signup_eligibility ON public.crm_referral_company_signups;
CREATE TRIGGER crm_referral_signup_eligibility
BEFORE UPDATE OF signup_status, paid_at, fraud_flag ON public.crm_referral_company_signups
FOR EACH ROW EXECUTE FUNCTION public.crm_referral_signup_eligibility_trg();

-- ===== Auto-seed program settings per tenant =====
CREATE OR REPLACE FUNCTION public.crm_referral_seed_settings_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.crm_referral_program_settings (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_referral_seed_settings ON public.tenants;
CREATE TRIGGER crm_referral_seed_settings
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.crm_referral_seed_settings_trg();

-- ===== updated_at maintenance =====
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS crm_partners_updated_at ON public.crm_referral_partners;
CREATE TRIGGER crm_partners_updated_at BEFORE UPDATE ON public.crm_referral_partners
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS crm_signups_updated_at ON public.crm_referral_company_signups;
CREATE TRIGGER crm_signups_updated_at BEFORE UPDATE ON public.crm_referral_company_signups
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS crm_payouts_updated_at ON public.crm_referral_payouts;
CREATE TRIGGER crm_payouts_updated_at BEFORE UPDATE ON public.crm_referral_payouts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS crm_payout_profiles_updated_at ON public.crm_referral_payout_profiles;
CREATE TRIGGER crm_payout_profiles_updated_at BEFORE UPDATE ON public.crm_referral_payout_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS crm_settings_updated_at ON public.crm_referral_program_settings;
CREATE TRIGGER crm_settings_updated_at BEFORE UPDATE ON public.crm_referral_program_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== Backfill program settings for existing tenants =====
INSERT INTO public.crm_referral_program_settings (tenant_id)
SELECT t.id FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.crm_referral_program_settings s WHERE s.tenant_id = t.id);
