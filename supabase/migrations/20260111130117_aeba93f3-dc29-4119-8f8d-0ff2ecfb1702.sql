-- =====================================================
-- PRESENTATION SECTIONS & ENHANCED SLIDES
-- Interactive Presentation Engine - Phase 1
-- =====================================================

-- Create presentation_sections table for non-linear navigation
CREATE TABLE IF NOT EXISTS public.presentation_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  presentation_id UUID NOT NULL REFERENCES public.presentations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT,
  color TEXT DEFAULT '#3b82f6',
  section_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  visibility_conditions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(presentation_id, slug)
);

-- Add new columns to presentation_slides for sections and dynamic content
ALTER TABLE public.presentation_slides 
ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES public.presentation_sections(id) ON DELETE SET NULL;

ALTER TABLE public.presentation_slides 
ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT true;

ALTER TABLE public.presentation_slides 
ADD COLUMN IF NOT EXISTS visibility_conditions JSONB DEFAULT '{}';

ALTER TABLE public.presentation_slides 
ADD COLUMN IF NOT EXISTS navigation_links JSONB DEFAULT '[]';

ALTER TABLE public.presentation_slides 
ADD COLUMN IF NOT EXISTS dynamic_fields TEXT[] DEFAULT '{}';

-- Create presentation_slide_views for granular tracking
CREATE TABLE IF NOT EXISTS public.presentation_slide_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.presentation_sessions(id) ON DELETE CASCADE,
  slide_id UUID REFERENCES public.presentation_slides(id) ON DELETE SET NULL,
  section_id UUID REFERENCES public.presentation_sections(id) ON DELETE SET NULL,
  view_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  view_ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  interaction_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create slide library for reusable content blocks
CREATE TABLE IF NOT EXISTS public.presentation_slide_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  slide_type TEXT NOT NULL,
  content_template JSONB NOT NULL DEFAULT '{}',
  thumbnail_url TEXT,
  is_global BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on new tables
ALTER TABLE public.presentation_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentation_slide_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentation_slide_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies for presentation_sections
CREATE POLICY "Users can view sections for their tenant presentations"
  ON public.presentation_sections FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can manage sections for their tenant presentations"
  ON public.presentation_sections FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- RLS Policies for presentation_slide_views
CREATE POLICY "Users can view slide views for their tenant"
  ON public.presentation_slide_views FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can insert slide views for their tenant"
  ON public.presentation_slide_views FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- RLS Policies for presentation_slide_library
CREATE POLICY "Users can view slide library for their tenant or global"
  ON public.presentation_slide_library FOR SELECT
  USING (
    is_global = true OR
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can manage slide library for their tenant"
  ON public.presentation_slide_library FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_presentation_sections_presentation 
  ON public.presentation_sections(presentation_id);

CREATE INDEX IF NOT EXISTS idx_presentation_sections_tenant 
  ON public.presentation_sections(tenant_id);

CREATE INDEX IF NOT EXISTS idx_presentation_slides_section 
  ON public.presentation_slides(section_id);

CREATE INDEX IF NOT EXISTS idx_presentation_slide_views_session 
  ON public.presentation_slide_views(session_id);

CREATE INDEX IF NOT EXISTS idx_presentation_slide_library_tenant 
  ON public.presentation_slide_library(tenant_id);

-- Add trigger for updated_at on presentation_sections
CREATE OR REPLACE FUNCTION public.update_presentation_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_presentation_sections_updated_at ON public.presentation_sections;
CREATE TRIGGER update_presentation_sections_updated_at
  BEFORE UPDATE ON public.presentation_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_presentation_sections_updated_at();