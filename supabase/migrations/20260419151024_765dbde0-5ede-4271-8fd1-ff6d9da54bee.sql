CREATE TABLE public.signup_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  first_name text,
  last_name text,
  company_name text,
  phone text,
  status text NOT NULL DEFAULT 'attempted',
  error_message text,
  error_code text,
  source text,
  user_agent text,
  ip_address text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_signup_attempts_created_at ON public.signup_attempts(created_at DESC);
CREATE INDEX idx_signup_attempts_status ON public.signup_attempts(status);
CREATE INDEX idx_signup_attempts_email ON public.signup_attempts(lower(email));

ALTER TABLE public.signup_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can log signup attempts"
  ON public.signup_attempts
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can read signup attempts"
  ON public.signup_attempts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('master','owner','corporate') OR p.is_developer = true)
    )
  );