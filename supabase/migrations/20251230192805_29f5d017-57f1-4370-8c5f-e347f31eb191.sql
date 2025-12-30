-- ===========================================
-- PROPOSAL GENERATOR: GOOD/BETTER/BEST TIERS
-- ===========================================

-- Add tier pricing fields to enhanced_estimates table
ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS selected_tier TEXT CHECK (selected_tier IS NULL OR selected_tier IN ('good', 'better', 'best'));

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS good_tier_total NUMERIC(12, 2);

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS better_tier_total NUMERIC(12, 2);

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS best_tier_total NUMERIC(12, 2);

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS tier_line_items JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS tracking_enabled BOOLEAN DEFAULT true;

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS cover_photo_url TEXT;

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS scope_of_work_html TEXT;

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS warranty_tier_details JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS financing_options JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.enhanced_estimates 
ADD COLUMN IF NOT EXISTS measurement_report_id UUID REFERENCES public.roof_measurements(id);

-- Create proposal tracking table for analytics
CREATE TABLE IF NOT EXISTS public.proposal_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  estimate_id UUID NOT NULL REFERENCES public.enhanced_estimates(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'sent', 'viewed', 'downloaded', 'tier_selected', 'signed', 'expired', 'declined')),
  viewer_email TEXT,
  viewer_ip TEXT,
  viewer_user_agent TEXT,
  duration_seconds INTEGER,
  page_views JSONB DEFAULT '[]'::jsonb,
  selected_tier TEXT CHECK (selected_tier IS NULL OR selected_tier IN ('good', 'better', 'best')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create tier-specific line items table
CREATE TABLE IF NOT EXISTS public.proposal_tier_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  estimate_id UUID NOT NULL REFERENCES public.enhanced_estimates(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('good', 'better', 'best')),
  item_type TEXT NOT NULL CHECK (item_type IN ('material', 'labor', 'fee', 'discount', 'warranty')),
  category TEXT,
  name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(10, 3) NOT NULL DEFAULT 1,
  unit TEXT,
  unit_cost NUMERIC(10, 2) NOT NULL,
  markup_percent NUMERIC(5, 2) DEFAULT 0,
  final_price NUMERIC(12, 2) NOT NULL,
  is_optional BOOLEAN DEFAULT false,
  is_included BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create proposal financing options table
CREATE TABLE IF NOT EXISTS public.proposal_financing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  estimate_id UUID NOT NULL REFERENCES public.enhanced_estimates(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('good', 'better', 'best')),
  provider TEXT NOT NULL,
  term_months INTEGER NOT NULL,
  apr_percent NUMERIC(5, 2) NOT NULL,
  monthly_payment NUMERIC(10, 2) NOT NULL,
  total_financed NUMERIC(12, 2) NOT NULL,
  down_payment NUMERIC(10, 2) DEFAULT 0,
  promo_text TEXT,
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_proposal_tracking_estimate ON public.proposal_tracking(estimate_id);
CREATE INDEX IF NOT EXISTS idx_proposal_tracking_event ON public.proposal_tracking(event_type);
CREATE INDEX IF NOT EXISTS idx_proposal_tracking_tenant ON public.proposal_tracking(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposal_tier_items_estimate ON public.proposal_tier_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_proposal_tier_items_tier ON public.proposal_tier_items(tier);
CREATE INDEX IF NOT EXISTS idx_proposal_financing_estimate ON public.proposal_financing(estimate_id);
CREATE INDEX IF NOT EXISTS idx_enhanced_estimates_selected_tier ON public.enhanced_estimates(selected_tier) WHERE selected_tier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enhanced_estimates_measurement ON public.enhanced_estimates(measurement_report_id) WHERE measurement_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enhanced_estimates_share_token ON public.enhanced_estimates(share_token) WHERE share_token IS NOT NULL;

-- Enable RLS
ALTER TABLE public.proposal_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_tier_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_financing ENABLE ROW LEVEL SECURITY;

-- RLS Policies for proposal_tracking
CREATE POLICY "Users can view their tenant's proposal tracking"
  ON public.proposal_tracking FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert tracking events"
  ON public.proposal_tracking FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- RLS Policies for proposal_tier_items
CREATE POLICY "Users can view their tenant's tier items"
  ON public.proposal_tier_items FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage their tenant's tier items"
  ON public.proposal_tier_items FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- RLS Policies for proposal_financing
CREATE POLICY "Users can view their tenant's financing"
  ON public.proposal_financing FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage their tenant's financing"
  ON public.proposal_financing FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Function to increment view count
CREATE OR REPLACE FUNCTION public.increment_estimate_views(p_estimate_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.enhanced_estimates
  SET 
    view_count = COALESCE(view_count, 0) + 1,
    last_viewed_at = now()
  WHERE id = p_estimate_id;
END;
$$;

-- Function to generate unique share token
CREATE OR REPLACE FUNCTION public.generate_share_token()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..24 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$;