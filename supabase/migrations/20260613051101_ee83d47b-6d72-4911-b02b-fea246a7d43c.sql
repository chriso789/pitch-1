
CREATE TABLE IF NOT EXISTS public.intuit_security_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_scope text NOT NULL DEFAULT 'intuit_security_review',
  status text NOT NULL DEFAULT 'completed',
  findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intuit_security_reviews TO authenticated;
GRANT ALL ON public.intuit_security_reviews TO service_role;
ALTER TABLE public.intuit_security_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Master manages security reviews"
  ON public.intuit_security_reviews
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE TABLE IF NOT EXISTS public.intuit_review_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_key text NOT NULL UNIQUE,
  question_text text NOT NULL,
  recommended_answer text NOT NULL,
  actual_answer text,
  implementation_status text NOT NULL DEFAULT 'unknown',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_needed text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intuit_review_answers TO authenticated;
GRANT ALL ON public.intuit_review_answers TO service_role;
ALTER TABLE public.intuit_review_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Master manages review answers"
  ON public.intuit_review_answers
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE TABLE IF NOT EXISTS public.app_support_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'support',
  subject text,
  message text,
  qbo_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_support_contacts TO authenticated;
GRANT ALL ON public.app_support_contacts TO service_role;
ALTER TABLE public.app_support_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master manages all support contacts"
  ON public.app_support_contacts
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "Tenant users insert own support contacts"
  ON public.app_support_contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (tenant_id IS NULL OR tenant_id = public.get_user_tenant_id())
  );

CREATE POLICY "Tenant users read own support contacts"
  ON public.app_support_contacts
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (tenant_id IS NOT NULL AND tenant_id = public.get_user_tenant_id())
  );

CREATE INDEX IF NOT EXISTS app_support_contacts_tenant_idx ON public.app_support_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS app_support_contacts_user_idx ON public.app_support_contacts(user_id);
CREATE INDEX IF NOT EXISTS intuit_security_reviews_created_idx ON public.intuit_security_reviews(created_at DESC);

NOTIFY pgrst, 'reload schema';
