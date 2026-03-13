
-- job_alerts table
CREATE TABLE public.job_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid,
  alert_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data_json jsonb DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own alerts"
  ON public.job_alerts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users update own alerts"
  ON public.job_alerts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role inserts alerts"
  ON public.job_alerts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX idx_job_alerts_user_unread ON public.job_alerts(user_id, created_at DESC) WHERE read_at IS NULL;

-- job_media table
CREATE TABLE public.job_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  file_url text NOT NULL,
  thumbnail_url text,
  category text NOT NULL DEFAULT 'roof_photo',
  label text NOT NULL DEFAULT 'other',
  metadata_json jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read job_media"
  ON public.job_media FOR SELECT
  TO authenticated
  USING (company_id IN (
    SELECT COALESCE(p.active_tenant_id, p.tenant_id) FROM public.profiles p WHERE p.id = auth.uid()
  ));

CREATE POLICY "Tenant members insert job_media"
  ON public.job_media FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (
    SELECT COALESCE(p.active_tenant_id, p.tenant_id) FROM public.profiles p WHERE p.id = auth.uid()
  ));

CREATE INDEX idx_job_media_job ON public.job_media(job_id, created_at DESC);

-- mobile_activity_logs table
CREATE TABLE public.mobile_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  entity_type text,
  entity_id text,
  metadata_json jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mobile_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own activity logs"
  ON public.mobile_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users read own activity logs"
  ON public.mobile_activity_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_mobile_activity_user ON public.mobile_activity_logs(user_id, created_at DESC);
