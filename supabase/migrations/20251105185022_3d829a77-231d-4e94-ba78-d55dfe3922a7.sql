-- ============================================================================
-- PHASE 1: EQUIPMENT TRACKING TABLES WITH RLS
-- ============================================================================

-- Equipment inventory table
CREATE TABLE IF NOT EXISTS public.equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_user_tenant_id(),
  equipment_type VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  serial_number VARCHAR(100),
  purchase_date DATE,
  purchase_cost NUMERIC(10,2),
  current_value NUMERIC(10,2),
  status VARCHAR(50) DEFAULT 'available',
  assigned_to UUID REFERENCES public.crews(id),
  last_maintenance_date DATE,
  next_maintenance_date DATE,
  location VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Equipment maintenance log
CREATE TABLE IF NOT EXISTS public.equipment_maintenance_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL DEFAULT get_user_tenant_id(),
  maintenance_type VARCHAR(100),
  performed_date DATE NOT NULL,
  performed_by UUID REFERENCES public.profiles(id),
  cost NUMERIC(10,2),
  description TEXT,
  next_service_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Equipment assignments (checkout/checkin)
CREATE TABLE IF NOT EXISTS public.equipment_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_user_tenant_id(),
  equipment_id UUID NOT NULL REFERENCES public.equipment(id),
  crew_id UUID REFERENCES public.crews(id),
  project_id UUID REFERENCES public.projects(id),
  assigned_date DATE NOT NULL,
  returned_date DATE,
  condition_at_checkout VARCHAR(50),
  condition_at_return VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_maintenance_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for equipment
CREATE POLICY "Users can view equipment in their tenant"
  ON public.equipment FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create equipment in their tenant"
  ON public.equipment FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update equipment in their tenant"
  ON public.equipment FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete equipment in their tenant"
  ON public.equipment FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies for maintenance log
CREATE POLICY "Users can view maintenance logs in their tenant"
  ON public.equipment_maintenance_log FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create maintenance logs"
  ON public.equipment_maintenance_log FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update maintenance logs"
  ON public.equipment_maintenance_log FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies for assignments
CREATE POLICY "Users can view assignments in their tenant"
  ON public.equipment_assignments FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create assignments"
  ON public.equipment_assignments FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update assignments"
  ON public.equipment_assignments FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_equipment_tenant ON public.equipment(tenant_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON public.equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_assigned_to ON public.equipment(assigned_to);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_equipment ON public.equipment_maintenance_log(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_tenant ON public.equipment_maintenance_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_equipment_assignments_equipment ON public.equipment_assignments(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_assignments_tenant ON public.equipment_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_equipment_assignments_crew ON public.equipment_assignments(crew_id);
CREATE INDEX IF NOT EXISTS idx_equipment_assignments_project ON public.equipment_assignments(project_id);