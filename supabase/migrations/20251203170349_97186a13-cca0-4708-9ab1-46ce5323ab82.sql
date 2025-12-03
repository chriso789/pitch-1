-- Create company onboarding tokens table
CREATE TABLE IF NOT EXISTS public.company_onboarding_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  onboarding_progress JSONB DEFAULT '{"current_step": 1, "completed_steps": []}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.company_onboarding_tokens ENABLE ROW LEVEL SECURITY;

-- Policy for public read by token (for onboarding page)
CREATE POLICY "Allow public read by token"
ON public.company_onboarding_tokens
FOR SELECT
TO public
USING (true);

-- Policy for authenticated updates
CREATE POLICY "Allow authenticated updates"
ON public.company_onboarding_tokens
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_onboarding_tokens_token ON public.company_onboarding_tokens(token);
CREATE INDEX IF NOT EXISTS idx_onboarding_tokens_tenant ON public.company_onboarding_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_tokens_expires ON public.company_onboarding_tokens(expires_at);