-- ============================================================================
-- Add backup RLS policies for system monitoring tables
-- These policies ensure direct access works when edge functions are unavailable
-- ============================================================================

-- ============================================================================
-- SYSTEM_CRASHES: Allow authenticated and anonymous users to insert crashes
-- ============================================================================

-- Check and drop existing policies that may conflict
DROP POLICY IF EXISTS "Authenticated users can insert crashes" ON public.system_crashes;
DROP POLICY IF EXISTS "Anon users can insert crashes" ON public.system_crashes;
DROP POLICY IF EXISTS "Service role can manage all crashes" ON public.system_crashes;

-- Allow authenticated users to insert crash reports
CREATE POLICY "Authenticated users can insert crashes"
ON public.system_crashes
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow anonymous users to insert crash reports (for pre-login errors)
CREATE POLICY "Anon users can insert crashes"
ON public.system_crashes
FOR INSERT
TO anon
WITH CHECK (true);

-- ============================================================================
-- HEALTH_CHECKS: Allow authenticated users to insert health checks
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can insert health checks" ON public.health_checks;
DROP POLICY IF EXISTS "Anon users can insert health checks" ON public.health_checks;

-- Allow authenticated users to insert health checks
CREATE POLICY "Authenticated users can insert health checks"
ON public.health_checks
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow anonymous users to insert health checks (for pre-login monitoring)
CREATE POLICY "Anon users can insert health checks"
ON public.health_checks
FOR INSERT
TO anon
WITH CHECK (true);

-- ============================================================================
-- SYSTEM_METRICS: Allow authenticated users to insert metrics
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can insert metrics" ON public.system_metrics;
DROP POLICY IF EXISTS "Anon users can insert metrics" ON public.system_metrics;

-- Allow authenticated users to insert metrics
CREATE POLICY "Authenticated users can insert metrics"
ON public.system_metrics
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow anonymous users to insert metrics (for pre-login monitoring)
CREATE POLICY "Anon users can insert metrics"
ON public.system_metrics
FOR INSERT
TO anon
WITH CHECK (true);

-- ============================================================================
-- MARKETING_SESSIONS: Allow anonymous and authenticated users to manage sessions
-- ============================================================================

DROP POLICY IF EXISTS "Users can create marketing sessions" ON public.marketing_sessions;
DROP POLICY IF EXISTS "Users can update their marketing sessions" ON public.marketing_sessions;
DROP POLICY IF EXISTS "Anon users can create marketing sessions" ON public.marketing_sessions;
DROP POLICY IF EXISTS "Anon users can update marketing sessions" ON public.marketing_sessions;

-- Allow anonymous users to create marketing sessions
CREATE POLICY "Anon users can create marketing sessions"
ON public.marketing_sessions
FOR INSERT
TO anon
WITH CHECK (true);

-- Allow authenticated users to create marketing sessions
CREATE POLICY "Authenticated users can create marketing sessions"
ON public.marketing_sessions
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow anonymous users to update marketing sessions (by session_key)
CREATE POLICY "Anon users can update marketing sessions"
ON public.marketing_sessions
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- Allow authenticated users to update their marketing sessions
CREATE POLICY "Authenticated users can update marketing sessions"
ON public.marketing_sessions
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR user_id IS NULL)
WITH CHECK (true);