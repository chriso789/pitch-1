-- ========================================
-- PHASE 11: Production Gate Enforcement
-- ========================================

-- Add gate requirements to production stages
ALTER TABLE production_stages 
ADD COLUMN IF NOT EXISTS gate_requirements JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS gate_documents_required BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS min_photos_required INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS requires_noc BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS requires_permit BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS requires_material_order BOOLEAN DEFAULT false;

-- Production gate validation audit trail
CREATE TABLE IF NOT EXISTS production_gate_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('passed', 'failed', 'bypassed')),
  validation_results JSONB DEFAULT '{}',
  bypassed_by UUID REFERENCES profiles(id),
  bypass_reason TEXT,
  validated_by UUID REFERENCES profiles(id),
  validated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE production_gate_validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view gate validations"
  ON production_gate_validations FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can create gate validations"
  ON production_gate_validations FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ========================================
-- PHASE 12: Sales Commission & Payouts
-- ========================================

-- Commission rules configuration
CREATE TABLE IF NOT EXISTS commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  role TEXT,
  commission_type TEXT NOT NULL CHECK (commission_type IN ('percentage', 'profit_split', 'flat_rate')),
  base_percentage DECIMAL(5,2) DEFAULT 0,
  profit_split_percentage DECIMAL(5,2) DEFAULT 0,
  flat_rate_amount DECIMAL(10,2) DEFAULT 0,
  profit_bonus_tiers JSONB DEFAULT '[]',
  applies_to_job_types TEXT[] DEFAULT '{}',
  minimum_contract_value DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Commission payouts tracking
CREATE TABLE IF NOT EXISTS commission_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  project_id UUID REFERENCES projects(id),
  pipeline_entry_id UUID REFERENCES pipeline_entries(id),
  rule_id UUID REFERENCES commission_rules(id),
  contract_value DECIMAL(10,2) NOT NULL,
  profit_margin DECIMAL(5,2),
  base_commission DECIMAL(10,2) NOT NULL DEFAULT 0,
  bonus_commission DECIMAL(10,2) DEFAULT 0,
  total_commission DECIMAL(10,2) NOT NULL,
  calculation_details JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'processing', 'paid', 'cancelled')),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Manager overrides
CREATE TABLE IF NOT EXISTS manager_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES profiles(id),
  rep_id UUID NOT NULL REFERENCES profiles(id),
  override_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view commission rules"
  ON commission_rules FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage commission rules"
  ON commission_rules FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view their own payouts"
  ON commission_payouts FOR SELECT
  USING (user_id = auth.uid() OR tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage payouts"
  ON commission_payouts FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view manager overrides"
  ON manager_overrides FOR SELECT
  USING (manager_id = auth.uid() OR rep_id = auth.uid() OR tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage manager overrides"
  ON manager_overrides FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ========================================
-- PHASE 20: Subcontractor Compliance
-- ========================================

-- Subcontractor compliance documents
CREATE TABLE IF NOT EXISTS subcontractor_compliance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subcontractor_id UUID NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('insurance_coi', 'w9', 'license', 'workers_comp', 'bond', 'safety_cert', 'other')),
  document_name TEXT,
  document_url TEXT,
  file_path TEXT,
  policy_number TEXT,
  coverage_amount DECIMAL(12,2),
  issued_at DATE,
  expires_at DATE,
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  reminder_sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subcontractor performance ratings
CREATE TABLE IF NOT EXISTS subcontractor_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subcontractor_id UUID NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id),
  quality_score INTEGER CHECK (quality_score BETWEEN 1 AND 5),
  timeliness_score INTEGER CHECK (timeliness_score BETWEEN 1 AND 5),
  communication_score INTEGER CHECK (communication_score BETWEEN 1 AND 5),
  safety_score INTEGER CHECK (safety_score BETWEEN 1 AND 5),
  overall_score DECIMAL(3,2) GENERATED ALWAYS AS (
    (COALESCE(quality_score, 3) + COALESCE(timeliness_score, 3) + 
     COALESCE(communication_score, 3) + COALESCE(safety_score, 3)) / 4.0
  ) STORED,
  notes TEXT,
  would_hire_again BOOLEAN,
  rated_by UUID REFERENCES profiles(id),
  rated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE subcontractor_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view subcontractor compliance"
  ON subcontractor_compliance FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can manage subcontractor compliance"
  ON subcontractor_compliance FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can view subcontractor ratings"
  ON subcontractor_ratings FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can create ratings"
  ON subcontractor_ratings FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_gate_validations_project ON production_gate_validations(project_id);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_user ON commission_payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_status ON commission_payouts(status);
CREATE INDEX IF NOT EXISTS idx_subcontractor_compliance_expires ON subcontractor_compliance(expires_at);
CREATE INDEX IF NOT EXISTS idx_subcontractor_compliance_status ON subcontractor_compliance(status);
CREATE INDEX IF NOT EXISTS idx_subcontractor_ratings_sub ON subcontractor_ratings(subcontractor_id);