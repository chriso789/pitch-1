
-- Phase 27: Add lifecycle stage to contacts
ALTER TABLE public.contacts 
  ADD COLUMN IF NOT EXISTS lifecycle_stage text DEFAULT 'prospect',
  ADD COLUMN IF NOT EXISTS lifecycle_updated_at timestamptz DEFAULT now();

-- Phase 26: Maintenance plans
CREATE TABLE public.maintenance_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  plan_type text NOT NULL DEFAULT 'roof_inspection',
  frequency text NOT NULL DEFAULT 'annual' CHECK (frequency IN ('annual','semi_annual','quarterly')),
  price numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled','expired')),
  next_service_date date,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.maintenance_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for maintenance_plans"
  ON public.maintenance_plans FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    OR tenant_id IN (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL));

CREATE TABLE public.maintenance_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.maintenance_plans(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  completed_date date,
  technician_id uuid REFERENCES public.profiles(id),
  notes text,
  photos text[],
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','missed')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.maintenance_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for maintenance_visits"
  ON public.maintenance_visits FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    OR tenant_id IN (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL));

-- Phase 29: Video testimonials
CREATE TABLE public.video_testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  video_url text,
  thumbnail_url text,
  duration_seconds integer,
  transcript text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','published','rejected')),
  recorded_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.video_testimonials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for video_testimonials"
  ON public.video_testimonials FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    OR tenant_id IN (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL));

-- Video testimonials storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('video-testimonials', 'video-testimonials', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload video testimonials"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'video-testimonials' AND auth.role() = 'authenticated');

CREATE POLICY "Anyone can view video testimonials"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'video-testimonials');

CREATE POLICY "Authenticated users can delete own video testimonials"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'video-testimonials' AND auth.role() = 'authenticated');
