-- ============================================================================
-- PROPOSAL ANALYTICS, FOLLOW-UPS, AND NOTIFICATION PREFERENCES
-- ============================================================================

-- Proposal notification preferences table
CREATE TABLE IF NOT EXISTS public.proposal_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  sms_on_view BOOLEAN DEFAULT true,
  sms_on_tier_select BOOLEAN DEFAULT true,
  sms_on_signature BOOLEAN DEFAULT true,
  email_on_view BOOLEAN DEFAULT false,
  email_on_tier_select BOOLEAN DEFAULT false,
  email_on_signature BOOLEAN DEFAULT true,
  phone_number TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- Enable RLS
ALTER TABLE public.proposal_notification_preferences ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own notification preferences"
  ON public.proposal_notification_preferences FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own notification preferences"
  ON public.proposal_notification_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own notification preferences"
  ON public.proposal_notification_preferences FOR UPDATE
  USING (user_id = auth.uid());

-- Proposal follow-ups table for automated sequences
CREATE TABLE IF NOT EXISTS public.proposal_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  estimate_id UUID NOT NULL,
  sequence_step INT NOT NULL CHECK (sequence_step IN (1, 2, 3)),
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'skipped')),
  email_template TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.proposal_follow_ups ENABLE ROW LEVEL SECURITY;

-- RLS policies for follow-ups
CREATE POLICY "Users can view their tenant's follow-ups"
  ON public.proposal_follow_ups FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "System can manage follow-ups"
  ON public.proposal_follow_ups FOR ALL
  USING (true);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_proposal_follow_ups_scheduled 
  ON public.proposal_follow_ups(scheduled_for) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_proposal_follow_ups_estimate 
  ON public.proposal_follow_ups(estimate_id);

-- Add tracking columns to enhanced_estimates if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'enhanced_estimates' AND column_name = 'first_viewed_at') THEN
    ALTER TABLE public.enhanced_estimates ADD COLUMN first_viewed_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'enhanced_estimates' AND column_name = 'last_viewed_at') THEN
    ALTER TABLE public.enhanced_estimates ADD COLUMN last_viewed_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'enhanced_estimates' AND column_name = 'view_count') THEN
    ALTER TABLE public.enhanced_estimates ADD COLUMN view_count INT DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'enhanced_estimates' AND column_name = 'tier_selected_at') THEN
    ALTER TABLE public.enhanced_estimates ADD COLUMN tier_selected_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'enhanced_estimates' AND column_name = 'signed_at') THEN
    ALTER TABLE public.enhanced_estimates ADD COLUMN signed_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'enhanced_estimates' AND column_name = 'follow_up_enabled') THEN
    ALTER TABLE public.enhanced_estimates ADD COLUMN follow_up_enabled BOOLEAN DEFAULT true;
  END IF;
END $$;

-- Create function to get proposal analytics
CREATE OR REPLACE FUNCTION public.get_proposal_analytics(
  p_tenant_id UUID,
  p_days INT DEFAULT 30
)
RETURNS TABLE (
  total_sent BIGINT,
  total_viewed BIGINT,
  total_signed BIGINT,
  view_rate NUMERIC,
  conversion_rate NUMERIC,
  avg_time_to_sign_hours NUMERIC,
  good_tier_count BIGINT,
  better_tier_count BIGINT,
  best_tier_count BIGINT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH proposal_stats AS (
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE first_viewed_at IS NOT NULL) as viewed,
      COUNT(*) FILTER (WHERE signed_at IS NOT NULL) as signed,
      COUNT(*) FILTER (WHERE selected_tier = 'good' AND signed_at IS NOT NULL) as good_count,
      COUNT(*) FILTER (WHERE selected_tier = 'better' AND signed_at IS NOT NULL) as better_count,
      COUNT(*) FILTER (WHERE selected_tier = 'best' AND signed_at IS NOT NULL) as best_count,
      AVG(EXTRACT(EPOCH FROM (signed_at - share_token_created_at)) / 3600) 
        FILTER (WHERE signed_at IS NOT NULL) as avg_sign_hours
    FROM enhanced_estimates
    WHERE tenant_id = p_tenant_id
      AND share_token_created_at >= NOW() - (p_days || ' days')::INTERVAL
  )
  SELECT 
    ps.total,
    ps.viewed,
    ps.signed,
    CASE WHEN ps.total > 0 THEN ROUND((ps.viewed::NUMERIC / ps.total) * 100, 1) ELSE 0 END,
    CASE WHEN ps.total > 0 THEN ROUND((ps.signed::NUMERIC / ps.total) * 100, 1) ELSE 0 END,
    ROUND(COALESCE(ps.avg_sign_hours, 0), 1),
    ps.good_count,
    ps.better_count,
    ps.best_count
  FROM proposal_stats ps;
END;
$$;

-- Create function to get rep performance
CREATE OR REPLACE FUNCTION public.get_proposal_rep_performance(
  p_tenant_id UUID,
  p_days INT DEFAULT 30
)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  proposals_sent BIGINT,
  proposals_viewed BIGINT,
  proposals_signed BIGINT,
  total_revenue NUMERIC,
  conversion_rate NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as user_id,
    p.full_name,
    COUNT(e.id) as proposals_sent,
    COUNT(e.id) FILTER (WHERE e.first_viewed_at IS NOT NULL) as proposals_viewed,
    COUNT(e.id) FILTER (WHERE e.signed_at IS NOT NULL) as proposals_signed,
    COALESCE(SUM(
      CASE 
        WHEN e.signed_at IS NOT NULL THEN
          CASE e.selected_tier
            WHEN 'good' THEN e.good_tier_total
            WHEN 'better' THEN e.better_tier_total
            WHEN 'best' THEN e.best_tier_total
            ELSE 0
          END
        ELSE 0
      END
    ), 0) as total_revenue,
    CASE 
      WHEN COUNT(e.id) > 0 
      THEN ROUND((COUNT(e.id) FILTER (WHERE e.signed_at IS NOT NULL)::NUMERIC / COUNT(e.id)) * 100, 1)
      ELSE 0 
    END as conversion_rate
  FROM public.profiles p
  LEFT JOIN public.enhanced_estimates e ON e.created_by = p.id 
    AND e.tenant_id = p_tenant_id
    AND e.share_token_created_at >= NOW() - (p_days || ' days')::INTERVAL
  WHERE p.tenant_id = p_tenant_id
  GROUP BY p.id, p.full_name
  ORDER BY proposals_signed DESC, proposals_sent DESC;
END;
$$;