-- Create supplier accounts and Billtrust integration tables
CREATE TABLE public.supplier_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  supplier_name TEXT NOT NULL,
  billtrust_email TEXT NOT NULL,
  billtrust_tenant_id TEXT,
  api_key_id TEXT,
  encrypted_credentials JSONB, -- Store encrypted password/API key
  connection_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('connected', 'disconnected', 'error', 'pending')),
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, billtrust_email)
);

-- Create supplier pricing sync logs
CREATE TABLE public.supplier_price_sync_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  supplier_account_id UUID NOT NULL REFERENCES public.supplier_accounts(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('manual', 'scheduled', 'webhook')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  products_processed INTEGER DEFAULT 0,
  products_updated INTEGER DEFAULT 0,
  products_added INTEGER DEFAULT 0,
  error_details JSONB,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Update price_cache table to reference supplier accounts
ALTER TABLE public.price_cache 
ADD COLUMN supplier_account_id UUID REFERENCES public.supplier_accounts(id) ON DELETE CASCADE;

-- Create index for better performance
CREATE INDEX idx_supplier_accounts_tenant ON public.supplier_accounts(tenant_id);
CREATE INDEX idx_supplier_accounts_status ON public.supplier_accounts(connection_status);
CREATE INDEX idx_price_sync_logs_supplier ON public.supplier_price_sync_logs(supplier_account_id);
CREATE INDEX idx_price_cache_supplier ON public.price_cache(supplier_account_id);

-- Enable RLS
ALTER TABLE public.supplier_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_price_sync_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for supplier_accounts
CREATE POLICY "Users can view supplier accounts in their tenant"
ON public.supplier_accounts FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage supplier accounts in their tenant"
ON public.supplier_accounts FOR ALL
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create RLS policies for supplier_price_sync_logs
CREATE POLICY "Users can view sync logs in their tenant"
ON public.supplier_price_sync_logs FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage sync logs in tenant"
ON public.supplier_price_sync_logs FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Add updated_at trigger
CREATE TRIGGER update_supplier_accounts_updated_at
BEFORE UPDATE ON public.supplier_accounts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();