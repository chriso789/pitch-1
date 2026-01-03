-- ============================================
-- PHASE 1: Territory Management Tables
-- ============================================

-- Check if territories table exists (may exist from PITCH CRM schema)
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS public.territories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    boundary_geojson JSONB NOT NULL DEFAULT '{}',
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    color TEXT DEFAULT '#3b82f6',
    active BOOLEAN DEFAULT true,
    metrics JSONB DEFAULT '{}',
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Territory visits tracking
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS public.territory_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    territory_id UUID REFERENCES public.territories(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    visit_type TEXT NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    outcome TEXT,
    notes TEXT,
    visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- ============================================
-- PHASE 3: Voicemail Templates Table
-- ============================================

CREATE TABLE IF NOT EXISTS public.voicemail_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  audio_url TEXT,
  script TEXT,
  is_tts BOOLEAN DEFAULT false,
  voice TEXT DEFAULT 'nova',
  usage_count INTEGER DEFAULT 0,
  callback_rate DECIMAL(5,2),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PHASE 4: Email Sequence Tables
-- ============================================

CREATE TABLE IF NOT EXISTS public.email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT, -- 'manual', 'lead_created', 'proposal_sent', etc.
  is_active BOOLEAN DEFAULT true,
  stats JSONB DEFAULT '{}',
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.email_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  delay_days INTEGER DEFAULT 0,
  delay_hours INTEGER DEFAULT 0,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  ab_variant TEXT, -- 'A', 'B', or null
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.email_sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sequence_id UUID NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  current_step INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active', -- 'active', 'paused', 'completed', 'unsubscribed'
  next_send_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Enable RLS on all new tables
-- ============================================

ALTER TABLE public.territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voicemail_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequence_enrollments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for territories
CREATE POLICY "Tenants can manage their territories" ON public.territories
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenants can manage territory visits" ON public.territory_visits
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenants can manage voicemail templates" ON public.voicemail_templates
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenants can manage email sequences" ON public.email_sequences
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view sequence steps" ON public.email_sequence_steps
  FOR SELECT USING (
    sequence_id IN (
      SELECT id FROM public.email_sequences 
      WHERE tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Tenants can manage email enrollments" ON public.email_sequence_enrollments
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_territories_tenant ON public.territories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_territories_assigned ON public.territories(assigned_to);
CREATE INDEX IF NOT EXISTS idx_territory_visits_territory ON public.territory_visits(territory_id);
CREATE INDEX IF NOT EXISTS idx_territory_visits_user ON public.territory_visits(user_id);
CREATE INDEX IF NOT EXISTS idx_voicemail_templates_tenant ON public.voicemail_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_sequences_tenant ON public.email_sequences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_sequence_steps_sequence ON public.email_sequence_steps(sequence_id);
CREATE INDEX IF NOT EXISTS idx_email_enrollments_sequence ON public.email_sequence_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS idx_email_enrollments_contact ON public.email_sequence_enrollments(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_enrollments_next_send ON public.email_sequence_enrollments(next_send_at) WHERE status = 'active';