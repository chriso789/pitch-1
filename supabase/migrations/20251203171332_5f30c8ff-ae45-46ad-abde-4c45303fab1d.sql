-- Onboarding Videos table for video tutorials
CREATE TABLE public.onboarding_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_key TEXT NOT NULL,
  video_type TEXT NOT NULL CHECK (video_type IN ('youtube', 'loom')),
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  duration_seconds INTEGER,
  thumbnail_url TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default videos for onboarding steps
INSERT INTO public.onboarding_videos (step_key, video_type, video_id, title, description, duration_seconds) VALUES
('measurements', 'youtube', 'dQw4w9WgXcQ', 'How to Use Roof Measurements', 'Learn how to pull satellite measurements and verify roof data', 180),
('estimates', 'youtube', 'dQw4w9WgXcQ', 'Creating Professional Estimates', 'Build accurate estimates with our template builder', 240),
('pipeline', 'youtube', 'dQw4w9WgXcQ', 'Managing Your Sales Pipeline', 'Track leads from first contact to closed deal', 200),
('smartdocs', 'youtube', 'dQw4w9WgXcQ', 'Smart Docs Setup Guide', 'Upload and manage company documents', 150),
('dashboard', 'youtube', 'dQw4w9WgXcQ', 'Dashboard Overview', 'Navigate your CRM dashboard', 120);

-- Onboarding Analytics table
CREATE TABLE public.onboarding_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID,
  step_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  completed BOOLEAN DEFAULT false,
  time_spent INTEGER DEFAULT 0,
  dropped_off BOOLEAN DEFAULT false,
  video_watched BOOLEAN DEFAULT false,
  video_watch_percent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Verified Company Domains table
CREATE TABLE public.verified_company_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'failed')),
  verification_method TEXT,
  dns_txt_record TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Blocked Email Domains table (free email providers)
CREATE TABLE public.blocked_email_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT UNIQUE NOT NULL,
  reason TEXT DEFAULT 'free_email_provider',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed blocked domains (common free email providers)
INSERT INTO public.blocked_email_domains (domain, reason) VALUES
('gmail.com', 'free_email_provider'),
('yahoo.com', 'free_email_provider'),
('hotmail.com', 'free_email_provider'),
('outlook.com', 'free_email_provider'),
('aol.com', 'free_email_provider'),
('icloud.com', 'free_email_provider'),
('mail.com', 'free_email_provider'),
('protonmail.com', 'free_email_provider'),
('zoho.com', 'free_email_provider'),
('yandex.com', 'free_email_provider'),
('gmx.com', 'free_email_provider'),
('live.com', 'free_email_provider'),
('msn.com', 'free_email_provider');

-- Walkthrough Analytics table (if not exists)
CREATE TABLE IF NOT EXISTS public.walkthrough_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID,
  step_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  completed BOOLEAN DEFAULT false,
  time_spent INTEGER DEFAULT 0,
  dropped_off BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.onboarding_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verified_company_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walkthrough_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view onboarding videos" ON public.onboarding_videos FOR SELECT USING (true);
CREATE POLICY "Master users can manage onboarding videos" ON public.onboarding_videos FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master')
);

CREATE POLICY "Users can insert their own analytics" ON public.onboarding_analytics FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view their own analytics" ON public.onboarding_analytics FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Master users can view all analytics" ON public.onboarding_analytics FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master')
);

CREATE POLICY "Tenant admins can manage domains" ON public.verified_company_domains FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Anyone can view blocked domains" ON public.blocked_email_domains FOR SELECT USING (true);

CREATE POLICY "Users can insert walkthrough analytics" ON public.walkthrough_analytics FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view own walkthrough analytics" ON public.walkthrough_analytics FOR SELECT USING (user_id = auth.uid());

-- Indexes
CREATE INDEX idx_onboarding_analytics_user ON public.onboarding_analytics(user_id);
CREATE INDEX idx_onboarding_analytics_tenant ON public.onboarding_analytics(tenant_id);
CREATE INDEX idx_onboarding_analytics_step ON public.onboarding_analytics(step_id);
CREATE INDEX idx_verified_domains_tenant ON public.verified_company_domains(tenant_id);
CREATE INDEX idx_verified_domains_domain ON public.verified_company_domains(domain);