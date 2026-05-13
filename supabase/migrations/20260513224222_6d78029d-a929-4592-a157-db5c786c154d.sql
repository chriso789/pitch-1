
CREATE TABLE IF NOT EXISTS public.referral_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  referral_submission_id uuid NOT NULL REFERENCES public.referral_submissions(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  reason text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ref_status_history_sub ON public.referral_status_history(referral_submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ref_status_history_tenant ON public.referral_status_history(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.referral_send_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  referral_link_id uuid REFERENCES public.referral_codes(id) ON DELETE SET NULL,
  referrer_contact_id uuid,
  channel text NOT NULL CHECK (channel IN ('sms','email','copy_link','manual','other')),
  recipient text,
  sent_by uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ref_send_logs_tenant ON public.referral_send_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ref_send_logs_link ON public.referral_send_logs(referral_link_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_events_iphash ON public.referral_events(referral_link_id, ip_hash, created_at DESC);

ALTER TABLE public.referral_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_send_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referral_status_history_tenant_all" ON public.referral_status_history;
CREATE POLICY "referral_status_history_tenant_all" ON public.referral_status_history
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "referral_send_logs_tenant_all" ON public.referral_send_logs;
CREATE POLICY "referral_send_logs_tenant_all" ON public.referral_send_logs
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

REVOKE ALL ON public.referral_status_history, public.referral_send_logs FROM anon;

CREATE OR REPLACE FUNCTION public.get_public_referral_reward_profile(_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _link public.referral_codes%ROWTYPE;
  _settings public.referral_program_settings%ROWTYPE;
  _first text;
BEGIN
  SELECT * INTO _link FROM public.referral_codes
   WHERE code = _code AND is_active = true AND coalesce(status,'active') = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;

  SELECT * INTO _settings FROM public.referral_program_settings WHERE tenant_id = _link.tenant_id;

  SELECT first_name INTO _first FROM public.contacts WHERE id = _link.customer_id;

  RETURN jsonb_build_object(
    'ok', true,
    'referral_code', _link.code,
    'referrer_first_name', _first,
    'enabled_methods', jsonb_build_object(
      'venmo', coalesce(_settings.allow_venmo, false),
      'zelle', coalesce(_settings.allow_zelle, false),
      'gift_card', coalesce(_settings.allow_gift_card, false),
      'stored_balance', coalesce(_settings.allow_stored_balance, false)
    ),
    'terms_text', _settings.terms_text,
    'tax_acknowledgment_required', true
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_public_referral_reward_profile(text) TO anon, authenticated;
