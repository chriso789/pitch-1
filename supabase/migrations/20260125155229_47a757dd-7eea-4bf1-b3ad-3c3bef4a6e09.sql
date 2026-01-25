-- Phase 41-70: Advanced Measurement System Tables (Safe migration)

-- Expert review queue assignments
CREATE TABLE IF NOT EXISTS public.expert_review_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID,
  reviewer_id UUID,
  priority INTEGER DEFAULT 5,
  deadline TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  review_notes TEXT,
  accuracy_score DECIMAL(5,2),
  time_spent_minutes INTEGER,
  tenant_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reviewer calibration tests
CREATE TABLE IF NOT EXISTS public.reviewer_calibration_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id UUID,
  test_measurement_id UUID,
  submitted_values JSONB,
  correct_values JSONB,
  accuracy_score DECIMAL(5,2),
  time_to_complete_seconds INTEGER,
  passed BOOLEAN,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  tenant_id UUID
);

-- Improvement action tracking for flywheel
CREATE TABLE IF NOT EXISTS public.improvement_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  priority TEXT DEFAULT 'medium',
  description TEXT NOT NULL,
  expected_impact DECIMAL(5,2),
  actual_impact DECIMAL(5,2),
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID,
  completed_by UUID,
  results TEXT,
  metadata JSONB,
  tenant_id UUID
);

-- Enable RLS on new tables
ALTER TABLE public.expert_review_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviewer_calibration_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.improvement_actions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS "Users can view their org review assignments" ON public.expert_review_assignments;
DROP POLICY IF EXISTS "Users can manage their org review assignments" ON public.expert_review_assignments;
DROP POLICY IF EXISTS "Users can view their org calibration tests" ON public.reviewer_calibration_tests;
DROP POLICY IF EXISTS "Users can create calibration tests in their org" ON public.reviewer_calibration_tests;
DROP POLICY IF EXISTS "Users can view their org improvement actions" ON public.improvement_actions;
DROP POLICY IF EXISTS "Users can manage their org improvement actions" ON public.improvement_actions;

-- RLS Policies for expert_review_assignments
CREATE POLICY "Users can view their org review assignments"
ON public.expert_review_assignments FOR SELECT
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can manage their org review assignments"
ON public.expert_review_assignments FOR ALL
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- RLS Policies for reviewer_calibration_tests
CREATE POLICY "Users can view their org calibration tests"
ON public.reviewer_calibration_tests FOR SELECT
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can create calibration tests in their org"
ON public.reviewer_calibration_tests FOR INSERT
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- RLS Policies for improvement_actions
CREATE POLICY "Users can view their org improvement actions"
ON public.improvement_actions FOR SELECT
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can manage their org improvement actions"
ON public.improvement_actions FOR ALL
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_expert_review_assignments_measurement 
ON public.expert_review_assignments(measurement_id);
CREATE INDEX IF NOT EXISTS idx_expert_review_assignments_status 
ON public.expert_review_assignments(status, tenant_id);
CREATE INDEX IF NOT EXISTS idx_calibration_tests_reviewer 
ON public.reviewer_calibration_tests(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_improvement_actions_status 
ON public.improvement_actions(status, priority);