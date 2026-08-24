CREATE TABLE public.login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  user_id UUID,
  status TEXT NOT NULL DEFAULT 'attempted',
  error_message TEXT,
  error_code TEXT,
  source TEXT,
  ip_address TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  timezone TEXT,
  isp TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.login_attempts TO authenticated;
GRANT ALL ON public.login_attempts TO service_role;

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view login attempts"
ON public.login_attempts
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'master'::app_role)
  OR public.has_role(auth.uid(), 'owner'::app_role)
);

CREATE INDEX idx_login_attempts_created_at ON public.login_attempts (created_at DESC);
CREATE INDEX idx_login_attempts_email ON public.login_attempts (lower(email));