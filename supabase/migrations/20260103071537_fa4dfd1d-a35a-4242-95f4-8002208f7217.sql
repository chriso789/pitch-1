-- ========================================
-- APPOINTMENTS & SCHEDULING
-- ========================================

-- Core Appointment System
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  appointment_type TEXT NOT NULL CHECK (appointment_type IN ('inspection', 'estimate', 'installation', 'follow_up', 'adjustment', 'other')),
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled', 'no_show')),
  address TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  notes TEXT,
  homeowner_preferences JSONB DEFAULT '{}',
  ai_suggested BOOLEAN DEFAULT false,
  ai_score INTEGER CHECK (ai_score >= 0 AND ai_score <= 100),
  weather_risk TEXT,
  weather_data JSONB,
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Scheduling Suggestions History
CREATE TABLE ai_scheduling_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  canvasser_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  appointment_type TEXT,
  suggested_slots JSONB NOT NULL,
  selected_slot JSONB,
  weather_data JSONB,
  canvasser_location JSONB,
  homeowner_preferences JSONB,
  travel_time_minutes INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- INSURANCE CLAIMS & SCOPE DOCUMENTS
-- ========================================

-- Insurance Claims Tracking
CREATE TABLE insurance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  claim_number TEXT,
  insurance_company TEXT,
  adjuster_name TEXT,
  adjuster_phone TEXT,
  adjuster_email TEXT,
  policy_number TEXT,
  date_of_loss DATE,
  claim_status TEXT DEFAULT 'pending' CHECK (claim_status IN ('pending', 'filed', 'approved', 'denied', 'supplemented', 'closed', 'in_review')),
  deductible_amount DECIMAL(10,2),
  approved_amount DECIMAL(10,2),
  acv_amount DECIMAL(10,2),
  rcv_amount DECIMAL(10,2),
  depreciation_amount DECIMAL(10,2),
  recoverable_depreciation DECIMAL(10,2),
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI-Generated Scope Documents
CREATE TABLE scope_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  insurance_claim_id UUID REFERENCES insurance_claims(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  document_number TEXT,
  document_type TEXT NOT NULL CHECK (document_type IN ('initial_scope', 'supplement', 'revision', 'final')),
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'submitted', 'rejected')),
  line_items JSONB NOT NULL DEFAULT '[]',
  damage_assessment_data JSONB,
  damage_photos JSONB DEFAULT '[]',
  total_amount DECIMAL(10,2),
  xactimate_compatible BOOLEAN DEFAULT true,
  xactimate_export_data JSONB,
  pdf_url TEXT,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Supplement Requests
CREATE TABLE supplement_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  insurance_claim_id UUID REFERENCES insurance_claims(id) ON DELETE CASCADE,
  scope_document_id UUID REFERENCES scope_documents(id) ON DELETE SET NULL,
  supplement_number TEXT,
  reason TEXT NOT NULL,
  additional_items JSONB NOT NULL DEFAULT '[]',
  supporting_photos JSONB DEFAULT '[]',
  original_amount DECIMAL(10,2),
  requested_amount DECIMAL(10,2),
  approved_amount DECIMAL(10,2),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'denied', 'partial')),
  adjuster_response TEXT,
  submitted_at TIMESTAMPTZ,
  response_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- CREW DISPATCH & GPS TRACKING
-- ========================================

-- Crew Job Assignments
CREATE TABLE crew_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  crew_id UUID REFERENCES crews(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  assignment_date DATE NOT NULL,
  scheduled_start TIME,
  scheduled_end TIME,
  status TEXT DEFAULT 'assigned' CHECK (status IN ('assigned', 'en_route', 'on_site', 'in_progress', 'completed', 'delayed', 'cancelled')),
  priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  route_order INTEGER,
  estimated_duration_minutes INTEGER,
  actual_duration_minutes INTEGER,
  address TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  notes TEXT,
  dispatch_time TIMESTAMPTZ,
  arrival_time TIMESTAMPTZ,
  completion_time TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Real-time Crew GPS Locations
CREATE TABLE crew_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  crew_id UUID REFERENCES crews(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  latitude DECIMAL(10,8) NOT NULL,
  longitude DECIMAL(11,8) NOT NULL,
  accuracy DECIMAL(6,2),
  heading DECIMAL(5,2),
  speed DECIMAL(6,2),
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- Optimized Dispatch Routes
CREATE TABLE dispatch_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  crew_id UUID REFERENCES crews(id) ON DELETE CASCADE,
  route_date DATE NOT NULL,
  start_location JSONB,
  end_location JSONB,
  stops JSONB NOT NULL DEFAULT '[]',
  total_distance_miles DECIMAL(8,2),
  total_duration_minutes INTEGER,
  optimization_score INTEGER CHECK (optimization_score >= 0 AND optimization_score <= 100),
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  route_polyline TEXT,
  weather_impact JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(crew_id, route_date)
);

-- ========================================
-- INDEXES FOR PERFORMANCE
-- ========================================

CREATE INDEX idx_appointments_tenant_date ON appointments(tenant_id, scheduled_start);
CREATE INDEX idx_appointments_assigned_to ON appointments(assigned_to, scheduled_start);
CREATE INDEX idx_appointments_status ON appointments(tenant_id, status);

CREATE INDEX idx_insurance_claims_tenant ON insurance_claims(tenant_id, claim_status);
CREATE INDEX idx_insurance_claims_job ON insurance_claims(job_id);

CREATE INDEX idx_scope_documents_claim ON scope_documents(insurance_claim_id);
CREATE INDEX idx_scope_documents_tenant ON scope_documents(tenant_id, status);

CREATE INDEX idx_supplement_requests_claim ON supplement_requests(insurance_claim_id);

CREATE INDEX idx_crew_assignments_date ON crew_assignments(crew_id, assignment_date);
CREATE INDEX idx_crew_assignments_tenant_date ON crew_assignments(tenant_id, assignment_date);
CREATE INDEX idx_crew_assignments_status ON crew_assignments(status);

CREATE INDEX idx_crew_locations_active ON crew_locations(crew_id, recorded_at DESC) WHERE is_active = true;
CREATE INDEX idx_crew_locations_tenant ON crew_locations(tenant_id, recorded_at DESC);

CREATE INDEX idx_dispatch_routes_crew_date ON dispatch_routes(crew_id, route_date);

-- ========================================
-- ROW LEVEL SECURITY
-- ========================================

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_scheduling_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE scope_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_routes ENABLE ROW LEVEL SECURITY;

-- Appointments policies
CREATE POLICY "Users can view appointments in their tenant" ON appointments
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert appointments in their tenant" ON appointments
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update appointments in their tenant" ON appointments
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete appointments in their tenant" ON appointments
  FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- AI Scheduling Suggestions policies
CREATE POLICY "Users can view scheduling suggestions in their tenant" ON ai_scheduling_suggestions
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert scheduling suggestions in their tenant" ON ai_scheduling_suggestions
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update scheduling suggestions in their tenant" ON ai_scheduling_suggestions
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Insurance Claims policies
CREATE POLICY "Users can view insurance claims in their tenant" ON insurance_claims
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert insurance claims in their tenant" ON insurance_claims
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update insurance claims in their tenant" ON insurance_claims
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete insurance claims in their tenant" ON insurance_claims
  FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Scope Documents policies
CREATE POLICY "Users can view scope documents in their tenant" ON scope_documents
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert scope documents in their tenant" ON scope_documents
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update scope documents in their tenant" ON scope_documents
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete scope documents in their tenant" ON scope_documents
  FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Supplement Requests policies
CREATE POLICY "Users can view supplement requests in their tenant" ON supplement_requests
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert supplement requests in their tenant" ON supplement_requests
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update supplement requests in their tenant" ON supplement_requests
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Crew Assignments policies
CREATE POLICY "Users can view crew assignments in their tenant" ON crew_assignments
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert crew assignments in their tenant" ON crew_assignments
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update crew assignments in their tenant" ON crew_assignments
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete crew assignments in their tenant" ON crew_assignments
  FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Crew Locations policies
CREATE POLICY "Users can view crew locations in their tenant" ON crew_locations
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert crew locations in their tenant" ON crew_locations
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update crew locations in their tenant" ON crew_locations
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Dispatch Routes policies
CREATE POLICY "Users can view dispatch routes in their tenant" ON dispatch_routes
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert dispatch routes in their tenant" ON dispatch_routes
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update dispatch routes in their tenant" ON dispatch_routes
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete dispatch routes in their tenant" ON dispatch_routes
  FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ========================================
-- TRIGGERS FOR UPDATED_AT
-- ========================================

CREATE TRIGGER update_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_insurance_claims_updated_at
  BEFORE UPDATE ON insurance_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scope_documents_updated_at
  BEFORE UPDATE ON scope_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_supplement_requests_updated_at
  BEFORE UPDATE ON supplement_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_crew_assignments_updated_at
  BEFORE UPDATE ON crew_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dispatch_routes_updated_at
  BEFORE UPDATE ON dispatch_routes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();