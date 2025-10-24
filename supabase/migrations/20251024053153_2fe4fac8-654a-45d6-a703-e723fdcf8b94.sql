-- ============================================
-- GROUP 1 COMPLETE SCHEMA MIGRATION
-- Phases 18, 16, 23
-- ============================================

-- ============================================
-- PHASE 18: Task Management Enhancement
-- ============================================

-- Add new columns to workflow_tasks
ALTER TABLE workflow_tasks 
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES workflow_tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_parent ON workflow_tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_assigned ON workflow_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_due_date ON workflow_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_status ON workflow_tasks(status);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_priority ON workflow_tasks(priority);

-- Create workflow_templates table
CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  template_type VARCHAR(100),
  template_data JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  is_system_template BOOLEAN DEFAULT false,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_tenant ON workflow_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_type ON workflow_templates(template_type);

-- RLS for workflow_templates
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view templates in their tenant"
  ON workflow_templates FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    OR is_system_template = true
  );

CREATE POLICY "Users can create templates in their tenant"
  ON workflow_templates FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update templates in their tenant"
  ON workflow_templates FOR UPDATE
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete templates in their tenant"
  ON workflow_templates FOR DELETE
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ============================================
-- PHASE 23: Customer Reviews & Satisfaction
-- ============================================

-- Create customer_reviews table
CREATE TABLE IF NOT EXISTS customer_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  review_source VARCHAR(50) DEFAULT 'email',
  reviewed_at TIMESTAMPTZ DEFAULT now(),
  is_public BOOLEAN DEFAULT false,
  response_text TEXT,
  responded_at TIMESTAMPTZ,
  responded_by UUID REFERENCES profiles(id),
  clj_number VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_reviews_tenant ON customer_reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_reviews_contact ON customer_reviews(contact_id);
CREATE INDEX IF NOT EXISTS idx_customer_reviews_project ON customer_reviews(project_id);
CREATE INDEX IF NOT EXISTS idx_customer_reviews_rating ON customer_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_customer_reviews_clj ON customer_reviews(clj_number);

-- RLS for customer_reviews
ALTER TABLE customer_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view reviews in their tenant"
  ON customer_reviews FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create reviews in their tenant"
  ON customer_reviews FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update reviews in their tenant"
  ON customer_reviews FOR UPDATE
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Create satisfaction_surveys table
CREATE TABLE IF NOT EXISTS satisfaction_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  survey_type VARCHAR(50) NOT NULL,
  nps_score INTEGER CHECK (nps_score >= 0 AND nps_score <= 10),
  sentiment VARCHAR(20),
  feedback JSONB,
  sent_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  clj_number VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_tenant ON satisfaction_surveys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_contact ON satisfaction_surveys(contact_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_project ON satisfaction_surveys(project_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_type ON satisfaction_surveys(survey_type);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_nps ON satisfaction_surveys(nps_score);

-- RLS for satisfaction_surveys
ALTER TABLE satisfaction_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view surveys in their tenant"
  ON satisfaction_surveys FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create surveys in their tenant"
  ON satisfaction_surveys FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update surveys in their tenant"
  ON satisfaction_surveys FOR UPDATE
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ============================================
-- PHASE 16: Add CLJ Number to Contacts
-- ============================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS clj_number VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_contacts_clj_number ON contacts(clj_number);

-- ============================================
-- Update Timestamps Trigger
-- ============================================

DROP TRIGGER IF EXISTS update_workflow_templates_updated_at ON workflow_templates;
CREATE TRIGGER update_workflow_templates_updated_at
  BEFORE UPDATE ON workflow_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_customer_reviews_updated_at ON customer_reviews;
CREATE TRIGGER update_customer_reviews_updated_at
  BEFORE UPDATE ON customer_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_satisfaction_surveys_updated_at ON satisfaction_surveys;
CREATE TRIGGER update_satisfaction_surveys_updated_at
  BEFORE UPDATE ON satisfaction_surveys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();