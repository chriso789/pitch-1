-- Create company_backups table for automated daily backups
CREATE TABLE IF NOT EXISTS public.company_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('daily_auto', 'manual', 'pre_deletion')),
  backup_storage_path TEXT NOT NULL,
  backup_size_bytes BIGINT,
  data_summary JSONB,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  error_message TEXT,
  initiated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create company_deletion_backups table for deletion audit trail
CREATE TABLE IF NOT EXISTS public.company_deletion_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_name TEXT NOT NULL,
  deleted_by UUID REFERENCES auth.users(id),
  deleted_by_name TEXT,
  deleted_by_email TEXT,
  backup_storage_path TEXT,
  backup_size_bytes BIGINT,
  email_sent_to TEXT,
  email_sent_at TIMESTAMPTZ,
  data_summary JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.company_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_deletion_backups ENABLE ROW LEVEL SECURITY;

-- RLS policies for company_backups (master role only)
CREATE POLICY "Master users can view all company backups" ON public.company_backups
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'master'
    )
  );

CREATE POLICY "Master users can insert company backups" ON public.company_backups
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'master'
    )
  );

-- RLS policies for company_deletion_backups (master role only)
CREATE POLICY "Master users can view deletion backups" ON public.company_deletion_backups
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'master'
    )
  );

CREATE POLICY "Master users can insert deletion backups" ON public.company_deletion_backups
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'master'
    )
  );

-- Create indexes
CREATE INDEX idx_company_backups_tenant_id ON public.company_backups(tenant_id);
CREATE INDEX idx_company_backups_created_at ON public.company_backups(created_at DESC);
CREATE INDEX idx_company_deletion_backups_company_id ON public.company_deletion_backups(company_id);
CREATE INDEX idx_company_deletion_backups_created_at ON public.company_deletion_backups(created_at DESC);

-- Create storage bucket for company backups (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-backups', 'company-backups', false)
ON CONFLICT (id) DO NOTHING;