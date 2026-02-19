
-- Track every change the AI agent makes
CREATE TABLE public.ai_admin_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  tool_name TEXT NOT NULL,
  tool_args JSONB NOT NULL DEFAULT '{}',
  result JSONB NOT NULL DEFAULT '{}',
  description TEXT,
  session_id UUID REFERENCES public.ai_chat_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Track projects/initiatives the AI is working on
CREATE TABLE public.ai_admin_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  changes JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE public.ai_admin_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_admin_projects ENABLE ROW LEVEL SECURITY;

-- Policies for ai_admin_changes
CREATE POLICY "Admin users can view their tenant changes"
  ON public.ai_admin_changes
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert changes"
  ON public.ai_admin_changes
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policies for ai_admin_projects
CREATE POLICY "Admin users can view their tenant projects"
  ON public.ai_admin_projects
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Admin users can manage their tenant projects"
  ON public.ai_admin_projects
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX idx_ai_admin_changes_tenant ON public.ai_admin_changes(tenant_id, created_at DESC);
CREATE INDEX idx_ai_admin_projects_tenant ON public.ai_admin_projects(tenant_id, status);
