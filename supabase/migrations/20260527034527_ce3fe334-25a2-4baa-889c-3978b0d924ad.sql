
-- QBO Phase 1: Legal acceptance gating + consent receipts + webhook audit

-- 1. legal_documents
CREATE TABLE IF NOT EXISTS public.legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_key text NOT NULL CHECK (document_key IN ('privacy_policy','terms_of_service','qbo_integration_consent')),
  version text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  body_markdown text NOT NULL,
  body_sha256 text NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_current_per_key
  ON public.legal_documents (document_key) WHERE is_current = true;

GRANT SELECT ON public.legal_documents TO authenticated;
GRANT ALL ON public.legal_documents TO service_role;

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated reads legal docs"
  ON public.legal_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Master manages legal docs"
  ON public.legal_documents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

-- 2. legal_acceptances (per-user, per-version)
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  document_key text NOT NULL,
  document_version text NOT NULL,
  document_id uuid NOT NULL REFERENCES public.legal_documents(id),
  body_sha256 text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text,
  UNIQUE (user_id, document_key, document_version)
);
CREATE INDEX IF NOT EXISTS legal_acceptances_tenant ON public.legal_acceptances(tenant_id);
CREATE INDEX IF NOT EXISTS legal_acceptances_user ON public.legal_acceptances(user_id);

GRANT SELECT, INSERT ON public.legal_acceptances TO authenticated;
GRANT ALL ON public.legal_acceptances TO service_role;

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own acceptances"
  ON public.legal_acceptances FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'master'::app_role));
CREATE POLICY "Users insert own acceptances"
  ON public.legal_acceptances FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.get_user_tenant_id(auth.uid()));

-- 3. integration_consents (per-connection-attempt)
CREATE TABLE IF NOT EXISTS public.integration_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  integration text NOT NULL CHECK (integration IN ('quickbooks')),
  consent_version text NOT NULL,
  consent_text_snapshot text NOT NULL,
  consent_text_sha256 text NOT NULL,
  expected_oauth_app_env text NOT NULL CHECK (expected_oauth_app_env IN ('development','production')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text,
  used_for_connection_id uuid
);
CREATE INDEX IF NOT EXISTS integration_consents_tenant ON public.integration_consents(tenant_id);
CREATE INDEX IF NOT EXISTS integration_consents_user ON public.integration_consents(user_id);

GRANT SELECT, INSERT ON public.integration_consents TO authenticated;
GRANT ALL ON public.integration_consents TO service_role;

ALTER TABLE public.integration_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own integration consents"
  ON public.integration_consents FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'master'::app_role));
CREATE POLICY "Users insert own integration consents"
  ON public.integration_consents FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.get_user_tenant_id(auth.uid()));

-- 4. Extend existing qbo_oauth_state with consent + env binding + expiry
ALTER TABLE public.qbo_oauth_state
  ADD COLUMN IF NOT EXISTS expected_oauth_app_env text,
  ADD COLUMN IF NOT EXISTS consent_id uuid,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 5. qbo_webhook_events (audit, one row per inbound delivery)
CREATE TABLE IF NOT EXISTS public.qbo_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  realm_id text,
  oauth_app_env text,
  signature_valid boolean NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_code text,
  error_message text
);
CREATE INDEX IF NOT EXISTS qbo_webhook_events_tenant ON public.qbo_webhook_events(tenant_id, received_at DESC);

GRANT SELECT ON public.qbo_webhook_events TO authenticated;
GRANT ALL ON public.qbo_webhook_events TO service_role;

ALTER TABLE public.qbo_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members read own webhook events"
  ON public.qbo_webhook_events FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.has_role(auth.uid(), 'master'::app_role));

-- 6. Seed initial legal documents (placeholder text; replace via legal review)
INSERT INTO public.legal_documents (document_key, version, body_markdown, body_sha256, is_current)
VALUES
  ('privacy_policy', '1.0',
   'Pitch CRM Privacy Policy v1.0 — placeholder. Pitch collects and processes data necessary to operate the CRM, including contact and account information you and your team enter. Replace this body with legal-reviewed copy before production launch.',
   encode(sha256('privacy_policy:1.0:placeholder'::bytea), 'hex'),
   true),
  ('terms_of_service', '1.0',
   'Pitch CRM Terms of Service v1.0 — placeholder. By using Pitch CRM you agree to acceptable-use, account, and liability terms. Replace this body with legal-reviewed copy before production launch.',
   encode(sha256('terms_of_service:1.0:placeholder'::bytea), 'hex'),
   true),
  ('qbo_integration_consent', '1.0',
   'QuickBooks Online Integration Consent v1.0. By connecting QuickBooks, you authorize Pitch CRM to read and write accounting records (customers, invoices, payment status) for the QuickBooks company you select, solely for the features you enable in Pitch. Pitch does not access more QuickBooks data than necessary for those features. Tokens are stored encrypted. You can disconnect at any time from Settings → Integrations.',
   encode(sha256('qbo_integration_consent:1.0:placeholder'::bytea), 'hex'),
   true)
ON CONFLICT (document_key, version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
