-- Create session_activity_log table to track all login attempts
CREATE TABLE IF NOT EXISTS public.session_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('login_success', 'login_failed', 'logout', 'session_refresh', 'password_reset_request')),
  ip_address TEXT,
  user_agent TEXT,
  device_info TEXT,
  location_info TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_session_activity_user_id ON public.session_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_session_activity_created_at ON public.session_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_activity_email ON public.session_activity_log(email);
CREATE INDEX IF NOT EXISTS idx_session_activity_event_type ON public.session_activity_log(event_type);

-- Enable RLS
ALTER TABLE public.session_activity_log ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own activity logs
CREATE POLICY "Users can view their own activity logs"
  ON public.session_activity_log
  FOR SELECT
  USING (auth.uid() = user_id OR email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Policy: Service role can insert activity logs (for edge functions)
CREATE POLICY "Service role can insert activity logs"
  ON public.session_activity_log
  FOR INSERT
  WITH CHECK (true);

-- Policy: Users can insert their own activity logs
CREATE POLICY "Users can insert their own activity logs"
  ON public.session_activity_log
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Add comment
COMMENT ON TABLE public.session_activity_log IS 'Tracks all user authentication activity including login attempts, logouts, and session events';