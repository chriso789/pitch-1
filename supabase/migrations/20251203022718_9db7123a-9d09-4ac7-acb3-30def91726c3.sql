-- User activity tracking table for disclosed monitoring
CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_category TEXT,
  action_details JSONB DEFAULT '{}',
  page_url TEXT,
  session_id TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_user_activity_log_tenant_id ON public.user_activity_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_user_id ON public.user_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_created_at ON public.user_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_action_type ON public.user_activity_log(action_type);

-- Simple RLS: Users can view logs in their tenant
CREATE POLICY "Users can view tenant activity logs"
  ON public.user_activity_log
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Users can view their own activity
CREATE POLICY "Users can view own activity"
  ON public.user_activity_log
  FOR SELECT
  USING (user_id = auth.uid());

-- Insert allowed for all authenticated users
CREATE POLICY "Authenticated users can insert activity"
  ON public.user_activity_log
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Add website field to tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS website_verified BOOLEAN DEFAULT false;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS website_metadata JSONB DEFAULT '{}';