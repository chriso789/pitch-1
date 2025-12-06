-- =============================================
-- PORTAL & MONITORING SYSTEM DATABASE SCHEMA
-- =============================================

-- Work Orders (for crew assignments)
CREATE TABLE IF NOT EXISTS public.work_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  crew_id UUID REFERENCES public.crews(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'on_hold', 'cancelled')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  scheduled_date DATE,
  scheduled_time TIME,
  completed_at TIMESTAMPTZ,
  estimated_hours DECIMAL(5,2),
  actual_hours DECIMAL(5,2),
  materials_used JSONB DEFAULT '[]',
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Portal Messages (crew/homeowner communication)
CREATE TABLE IF NOT EXISTS public.portal_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('crew', 'homeowner', 'admin', 'system')),
  sender_id UUID,
  recipient_type TEXT CHECK (recipient_type IN ('crew', 'homeowner', 'admin', 'all')),
  recipient_id UUID,
  subject TEXT,
  message TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crew Time Entries
CREATE TABLE IF NOT EXISTS public.crew_time_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  crew_member_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  break_minutes INTEGER DEFAULT 0,
  location_in JSONB,
  location_out JSONB,
  notes TEXT,
  approved BOOLEAN DEFAULT FALSE,
  approved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System Crashes & Recovery
CREATE TABLE IF NOT EXISTS public.system_crashes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  error_type TEXT NOT NULL,
  error_message TEXT,
  stack_trace TEXT,
  component TEXT,
  route TEXT,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_agent TEXT,
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id),
  auto_recovered BOOLEAN DEFAULT FALSE,
  recovery_action TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Health Checks
CREATE TABLE IF NOT EXISTS public.health_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'down', 'unknown')),
  response_time_ms INTEGER,
  error_message TEXT,
  details JSONB DEFAULT '{}',
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- System Metrics
CREATE TABLE IF NOT EXISTS public.system_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  metric_name TEXT NOT NULL,
  metric_value DECIMAL(15,4),
  metric_unit TEXT,
  tags JSONB DEFAULT '{}',
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crew Portal Sessions
CREATE TABLE IF NOT EXISTS public.crew_portal_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  crew_member_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  device_info JSONB DEFAULT '{}',
  ip_address INET,
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Homeowner Portal Sessions
CREATE TABLE IF NOT EXISTS public.homeowner_portal_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant ON public.work_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_project ON public.work_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON public.work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned ON public.work_orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_portal_messages_project ON public.portal_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_portal_messages_sender ON public.portal_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_crew_time_entries_member ON public.crew_time_entries(crew_member_id);
CREATE INDEX IF NOT EXISTS idx_crew_time_entries_date ON public.crew_time_entries(clock_in);
CREATE INDEX IF NOT EXISTS idx_system_crashes_created ON public.system_crashes(created_at);
CREATE INDEX IF NOT EXISTS idx_system_crashes_severity ON public.system_crashes(severity);
CREATE INDEX IF NOT EXISTS idx_health_checks_service ON public.health_checks(service_name);
CREATE INDEX IF NOT EXISTS idx_system_metrics_name ON public.system_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_system_metrics_recorded ON public.system_metrics(recorded_at);

-- Enable RLS
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_crashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homeowner_portal_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for work_orders
CREATE POLICY "Users can view work orders in their tenant" ON public.work_orders
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create work orders in their tenant" ON public.work_orders
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update work orders in their tenant" ON public.work_orders
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

-- RLS Policies for portal_messages
CREATE POLICY "Users can view portal messages in their tenant" ON public.portal_messages
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create portal messages in their tenant" ON public.portal_messages
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

-- RLS Policies for crew_time_entries
CREATE POLICY "Users can view time entries in their tenant" ON public.crew_time_entries
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create time entries in their tenant" ON public.crew_time_entries
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update time entries in their tenant" ON public.crew_time_entries
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

-- RLS Policies for system tables (admin only via service role)
CREATE POLICY "System crashes visible to authenticated users" ON public.system_crashes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Health checks visible to authenticated users" ON public.health_checks
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "System metrics visible to authenticated users" ON public.system_metrics
  FOR SELECT USING (auth.role() = 'authenticated');

-- Trigger for updated_at on work_orders
CREATE OR REPLACE FUNCTION public.update_work_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_work_orders_timestamp
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_work_orders_updated_at();