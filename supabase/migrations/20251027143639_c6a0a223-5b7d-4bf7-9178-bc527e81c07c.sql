-- Phase 25: Time Tracking & Labor Management Tables

-- Time entry tracking for crew and staff
CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  entry_date DATE NOT NULL,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  total_hours NUMERIC,
  break_duration_minutes INTEGER DEFAULT 0,
  labor_type VARCHAR(50) DEFAULT 'regular',
  hourly_rate NUMERIC,
  total_cost NUMERIC,
  notes TEXT,
  location_coordinates JSONB,
  status VARCHAR(20) DEFAULT 'draft',
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies for time_entries
CREATE POLICY "Users can view time entries in their tenant"
  ON time_entries FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert their own time entries"
  ON time_entries FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND user_id = auth.uid());

CREATE POLICY "Users can update time entries in their tenant"
  ON time_entries FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Managers can delete time entries in their tenant"
  ON time_entries FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Track labor budget vs actual by project
CREATE TABLE IF NOT EXISTS labor_cost_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  budgeted_hours NUMERIC DEFAULT 0,
  budgeted_rate NUMERIC DEFAULT 0,
  budgeted_total NUMERIC DEFAULT 0,
  actual_hours NUMERIC DEFAULT 0,
  actual_cost NUMERIC DEFAULT 0,
  variance_hours NUMERIC DEFAULT 0,
  variance_cost NUMERIC DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE labor_cost_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies for labor_cost_tracking
CREATE POLICY "Users can view labor cost tracking in their tenant"
  ON labor_cost_tracking FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage labor cost tracking"
  ON labor_cost_tracking FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_time_entries_tenant_id ON time_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_entry_date ON time_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_labor_cost_tracking_tenant_id ON labor_cost_tracking(tenant_id);
CREATE INDEX IF NOT EXISTS idx_labor_cost_tracking_project_id ON labor_cost_tracking(project_id);