-- Create safety tables
CREATE TABLE IF NOT EXISTS safety_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_user_tenant_id(),
  project_id UUID REFERENCES projects(id),
  reported_by UUID REFERENCES auth.users(id),
  incident_date TIMESTAMPTZ NOT NULL,
  incident_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('minor', 'moderate', 'serious', 'critical')),
  description TEXT NOT NULL,
  location TEXT,
  injuries_reported BOOLEAN DEFAULT false,
  witnesses TEXT[],
  corrective_actions TEXT,
  status TEXT DEFAULT 'reported' CHECK (status IN ('reported', 'investigating', 'resolved', 'closed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safety_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_user_tenant_id(),
  project_id UUID REFERENCES projects(id),
  inspector_id UUID REFERENCES auth.users(id),
  inspection_date TIMESTAMPTZ NOT NULL,
  inspection_type TEXT NOT NULL,
  checklist_items JSONB,
  passed BOOLEAN,
  violations TEXT[],
  notes TEXT,
  next_inspection_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safety_training (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_user_tenant_id(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  training_type TEXT NOT NULL,
  training_date TIMESTAMPTZ NOT NULL,
  expiration_date TIMESTAMPTZ,
  instructor TEXT,
  certification_number TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'pending')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_safety_incidents_tenant ON safety_incidents(tenant_id);
CREATE INDEX idx_safety_incidents_project ON safety_incidents(project_id);
CREATE INDEX idx_safety_inspections_tenant ON safety_inspections(tenant_id);
CREATE INDEX idx_safety_inspections_project ON safety_inspections(project_id);
CREATE INDEX idx_safety_training_tenant ON safety_training(tenant_id);
CREATE INDEX idx_safety_training_user ON safety_training(user_id);
CREATE INDEX idx_safety_training_expiration ON safety_training(expiration_date) WHERE status = 'active';