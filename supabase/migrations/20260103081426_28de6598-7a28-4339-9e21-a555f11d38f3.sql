-- ========================================
-- AI MEASUREMENT ANALYSIS (Phase 3)
-- ========================================
CREATE TABLE IF NOT EXISTS public.ai_measurement_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  property_address TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  imagery_source TEXT DEFAULT 'satellite',
  imagery_url TEXT,
  analysis_status TEXT DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'processing', 'completed', 'failed')),
  total_roof_area DECIMAL(10, 2),
  total_facets INTEGER,
  predominant_pitch TEXT,
  facet_data JSONB DEFAULT '[]',
  ridge_length DECIMAL(10, 2),
  valley_length DECIMAL(10, 2),
  hip_length DECIMAL(10, 2),
  eave_length DECIMAL(10, 2),
  rake_length DECIMAL(10, 2),
  waste_factor DECIMAL(5, 2) DEFAULT 10,
  material_takeoff JSONB DEFAULT '{}',
  confidence_score DECIMAL(5, 2),
  accuracy_notes TEXT,
  processing_time_ms INTEGER,
  ai_model_version TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.ai_measurement_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's analyses" ON public.ai_measurement_analysis
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create analyses for their tenant" ON public.ai_measurement_analysis
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their tenant's analyses" ON public.ai_measurement_analysis
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ========================================
-- WARRANTIES (Phase 7)
-- ========================================
CREATE TABLE IF NOT EXISTS public.warranties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  warranty_type TEXT NOT NULL CHECK (warranty_type IN ('manufacturer', 'labor', 'extended', 'transferable')),
  manufacturer_name TEXT,
  product_name TEXT,
  warranty_number TEXT,
  coverage_description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  term_years INTEGER,
  coverage_amount DECIMAL(10, 2),
  is_transferable BOOLEAN DEFAULT false,
  transfer_fee DECIMAL(10, 2),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'claimed', 'transferred', 'voided')),
  document_urls TEXT[],
  notes TEXT,
  reminder_sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.warranties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's warranties" ON public.warranties
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create warranties for their tenant" ON public.warranties
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their tenant's warranties" ON public.warranties
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ========================================
-- WARRANTY CLAIMS (Phase 7)
-- ========================================
CREATE TABLE IF NOT EXISTS public.warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warranty_id UUID NOT NULL REFERENCES warranties(id) ON DELETE CASCADE,
  claim_number TEXT,
  claim_date DATE NOT NULL DEFAULT CURRENT_DATE,
  issue_description TEXT NOT NULL,
  issue_photos TEXT[],
  status TEXT DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'denied', 'completed')),
  resolution TEXT,
  resolution_date DATE,
  claim_amount DECIMAL(10, 2),
  approved_amount DECIMAL(10, 2),
  manufacturer_claim_id TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.warranty_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's warranty claims" ON public.warranty_claims
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create warranty claims" ON public.warranty_claims
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their tenant's claims" ON public.warranty_claims
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ========================================
-- SUBCONTRACTOR PROFILES (Phase 10)
-- ========================================
CREATE TABLE IF NOT EXISTS public.subcontractor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  license_number TEXT,
  license_expiry DATE,
  insurance_carrier TEXT,
  insurance_policy_number TEXT,
  insurance_expiry DATE,
  workers_comp_policy TEXT,
  workers_comp_expiry DATE,
  specialties TEXT[],
  service_area TEXT[],
  hourly_rate DECIMAL(10, 2),
  day_rate DECIMAL(10, 2),
  rating DECIMAL(3, 2),
  total_jobs_completed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending', 'suspended')),
  notes TEXT,
  documents JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.subcontractor_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's subcontractors" ON public.subcontractor_profiles
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create subcontractors" ON public.subcontractor_profiles
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their tenant's subcontractors" ON public.subcontractor_profiles
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ========================================
-- SUBCONTRACTOR ASSIGNMENTS (Phase 10)
-- ========================================
CREATE TABLE IF NOT EXISTS public.subcontractor_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subcontractor_id UUID NOT NULL REFERENCES subcontractor_profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  assignment_type TEXT NOT NULL,
  scheduled_date DATE,
  scheduled_start_time TIME,
  scheduled_end_time TIME,
  actual_start_time TIMESTAMPTZ,
  actual_end_time TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'in_progress', 'completed', 'cancelled')),
  estimated_hours DECIMAL(5, 2),
  actual_hours DECIMAL(5, 2),
  agreed_rate DECIMAL(10, 2),
  rate_type TEXT DEFAULT 'hourly' CHECK (rate_type IN ('hourly', 'daily', 'fixed')),
  total_amount DECIMAL(10, 2),
  notes TEXT,
  completion_photos TEXT[],
  quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.subcontractor_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's assignments" ON public.subcontractor_assignments
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create assignments" ON public.subcontractor_assignments
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their tenant's assignments" ON public.subcontractor_assignments
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ========================================
-- SUBCONTRACTOR INVOICES (Phase 10)
-- ========================================
CREATE TABLE IF NOT EXISTS public.subcontractor_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subcontractor_id UUID NOT NULL REFERENCES subcontractor_profiles(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  line_items JSONB NOT NULL DEFAULT '[]',
  subtotal DECIMAL(10, 2) NOT NULL,
  tax_amount DECIMAL(10, 2) DEFAULT 0,
  total_amount DECIMAL(10, 2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'approved', 'paid', 'disputed', 'void')),
  payment_date DATE,
  payment_method TEXT,
  payment_reference TEXT,
  notes TEXT,
  attachments TEXT[],
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.subcontractor_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's invoices" ON public.subcontractor_invoices
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create invoices" ON public.subcontractor_invoices
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their tenant's invoices" ON public.subcontractor_invoices
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_measurement_analysis_tenant ON ai_measurement_analysis(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_measurement_analysis_project ON ai_measurement_analysis(project_id);
CREATE INDEX IF NOT EXISTS idx_warranties_tenant ON warranties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warranties_project ON warranties(project_id);
CREATE INDEX IF NOT EXISTS idx_warranties_end_date ON warranties(end_date);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_warranty ON warranty_claims(warranty_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_profiles_tenant ON subcontractor_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_assignments_tenant ON subcontractor_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_assignments_sub ON subcontractor_assignments(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_invoices_sub ON subcontractor_invoices(subcontractor_id);