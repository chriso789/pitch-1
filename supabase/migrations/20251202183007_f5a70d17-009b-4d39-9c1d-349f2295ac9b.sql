-- =====================================================
-- SECURITY REMEDIATION: Canvass Session Tokens & Rate Limiting
-- =====================================================

-- 1. Create canvass_sessions table for secure token storage
CREATE TABLE public.canvass_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz DEFAULT now(),
  ip_address inet,
  user_agent text
);

-- Enable RLS
ALTER TABLE public.canvass_sessions ENABLE ROW LEVEL SECURITY;

-- Indexes for performance
CREATE INDEX idx_canvass_sessions_token ON public.canvass_sessions(token);
CREATE INDEX idx_canvass_sessions_user_id ON public.canvass_sessions(user_id);
CREATE INDEX idx_canvass_sessions_expires_at ON public.canvass_sessions(expires_at);

-- Policy: Service role only (no direct user access)
CREATE POLICY "Service role manages canvass sessions"
ON public.canvass_sessions FOR ALL 
TO service_role
USING (true) WITH CHECK (true);

-- Function to validate and refresh tokens
CREATE OR REPLACE FUNCTION public.validate_canvass_token(p_token text)
RETURNS TABLE(user_id uuid, tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Update last_used_at and return session data
  RETURN QUERY
  UPDATE canvass_sessions 
  SET last_used_at = now()
  WHERE token = p_token 
    AND expires_at > now()
  RETURNING canvass_sessions.user_id, canvass_sessions.tenant_id;
END;
$$;

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION public.cleanup_expired_canvass_sessions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM canvass_sessions WHERE expires_at < now();
END;
$$;

-- 2. Create rate_limits table
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  resource text NOT NULL,
  request_count integer DEFAULT 1,
  window_start timestamptz DEFAULT now(),
  UNIQUE(user_id, resource)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Service role only
CREATE POLICY "Service role manages rate limits"
ON public.rate_limits FOR ALL 
TO service_role
USING (true) WITH CHECK (true);

-- Rate limit check function
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_resource text,
  p_limit integer,
  p_window_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  -- Cleanup old entries
  DELETE FROM rate_limits 
  WHERE resource = p_resource 
    AND window_start < now() - (p_window_minutes || ' minutes')::interval;
  
  -- Insert or update count
  INSERT INTO rate_limits (user_id, resource, request_count, window_start)
  VALUES (p_user_id, p_resource, 1, now())
  ON CONFLICT (user_id, resource) DO UPDATE
  SET request_count = CASE 
    WHEN rate_limits.window_start < now() - (p_window_minutes || ' minutes')::interval 
    THEN 1
    ELSE rate_limits.request_count + 1
  END,
  window_start = CASE
    WHEN rate_limits.window_start < now() - (p_window_minutes || ' minutes')::interval
    THEN now()
    ELSE rate_limits.window_start
  END
  RETURNING request_count INTO v_count;
  
  RETURN jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'remaining', GREATEST(0, p_limit - v_count)
  );
END;
$$;

-- 3. Tighten RLS on building_footprints (require authentication)
DROP POLICY IF EXISTS "Building footprints are viewable by everyone" ON public.building_footprints;
CREATE POLICY "Authenticated users can view building footprints"
ON public.building_footprints FOR SELECT
TO authenticated
USING (true);

-- 4. Tighten RLS on satellite_image_cache (require authentication)
DROP POLICY IF EXISTS "Anyone can read cache metadata" ON public.satellite_image_cache;
CREATE POLICY "Authenticated users can view satellite cache"
ON public.satellite_image_cache FOR SELECT
TO authenticated
USING (true);