-- Create presentations table
CREATE TABLE IF NOT EXISTS public.presentations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    template_type TEXT NOT NULL DEFAULT 'custom',
    is_template BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create presentation_slides table
CREATE TABLE IF NOT EXISTS public.presentation_slides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    presentation_id UUID NOT NULL REFERENCES public.presentations(id) ON DELETE CASCADE,
    slide_order INTEGER NOT NULL,
    slide_type TEXT NOT NULL,
    content JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    transition_effect TEXT DEFAULT 'fade',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create presentation_sessions table
CREATE TABLE IF NOT EXISTS public.presentation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    presentation_id UUID NOT NULL REFERENCES public.presentations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    completed_at TIMESTAMP WITH TIME ZONE,
    current_slide_index INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    signature_captured BOOLEAN DEFAULT false,
    signature_data JSONB,
    viewer_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_presentations_tenant ON public.presentations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_presentations_template ON public.presentations(tenant_id, is_template);
CREATE INDEX IF NOT EXISTS idx_presentation_slides_presentation ON public.presentation_slides(presentation_id);
CREATE INDEX IF NOT EXISTS idx_presentation_slides_order ON public.presentation_slides(presentation_id, slide_order);
CREATE INDEX IF NOT EXISTS idx_presentation_sessions_presentation ON public.presentation_sessions(presentation_id);
CREATE INDEX IF NOT EXISTS idx_presentation_sessions_contact ON public.presentation_sessions(contact_id);

-- Enable Row Level Security
ALTER TABLE public.presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentation_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentation_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for presentations
CREATE POLICY "Users can view presentations in their tenant"
    ON public.presentations FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create presentations in their tenant"
    ON public.presentations FOR INSERT
    WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update presentations in their tenant"
    ON public.presentations FOR UPDATE
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete presentations in their tenant"
    ON public.presentations FOR DELETE
    USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

-- RLS Policies for presentation_slides
CREATE POLICY "Users can view slides in their tenant"
    ON public.presentation_slides FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.presentations p
        WHERE p.id = presentation_slides.presentation_id
        AND p.tenant_id = get_user_tenant_id()
    ));

CREATE POLICY "Users can create slides in their tenant"
    ON public.presentation_slides FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.presentations p
        WHERE p.id = presentation_slides.presentation_id
        AND p.tenant_id = get_user_tenant_id()
    ));

CREATE POLICY "Users can update slides in their tenant"
    ON public.presentation_slides FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.presentations p
        WHERE p.id = presentation_slides.presentation_id
        AND p.tenant_id = get_user_tenant_id()
    ));

CREATE POLICY "Users can delete slides in their tenant"
    ON public.presentation_slides FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM public.presentations p
        WHERE p.id = presentation_slides.presentation_id
        AND p.tenant_id = get_user_tenant_id()
    ));

-- RLS Policies for presentation_sessions
CREATE POLICY "Users can view sessions in their tenant"
    ON public.presentation_sessions FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create sessions in their tenant"
    ON public.presentation_sessions FOR INSERT
    WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update sessions in their tenant"
    ON public.presentation_sessions FOR UPDATE
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete sessions in their tenant"
    ON public.presentation_sessions FOR DELETE
    USING (tenant_id = get_user_tenant_id());