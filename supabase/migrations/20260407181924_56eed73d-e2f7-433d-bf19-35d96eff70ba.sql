
-- Create measurement_jobs table for async AI measurement processing
CREATE TABLE public.measurement_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  pipeline_entry_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  progress_message TEXT DEFAULT 'Queued for processing',
  measurement_id UUID,
  error TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  address TEXT,
  pitch_override TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for polling by pipeline entry
CREATE INDEX idx_measurement_jobs_pipeline ON public.measurement_jobs (pipeline_entry_id, created_at DESC);
CREATE INDEX idx_measurement_jobs_status ON public.measurement_jobs (status) WHERE status IN ('queued', 'processing');

-- Enable RLS
ALTER TABLE public.measurement_jobs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view jobs for their leads
CREATE POLICY "Users can view measurement jobs"
  ON public.measurement_jobs
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can create jobs
CREATE POLICY "Users can create measurement jobs"
  ON public.measurement_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Service role updates handled by edge functions (no user UPDATE policy needed since edge functions use service role)
