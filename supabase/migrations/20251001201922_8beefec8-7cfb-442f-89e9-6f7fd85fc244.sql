-- Phase 3 & 4: Payment Sync and Error Handling (Fixed v2)

-- Payment history tracking
CREATE TABLE IF NOT EXISTS public.qbo_payment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    qbo_payment_id TEXT NOT NULL,
    qbo_invoice_id TEXT NOT NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    payment_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    payment_date DATE NOT NULL,
    payment_method TEXT,
    qbo_customer_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS for payment history
ALTER TABLE public.qbo_payment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payment history in their tenant"
    ON public.qbo_payment_history FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert payment history"
    ON public.qbo_payment_history FOR INSERT
    WITH CHECK (tenant_id = get_user_tenant_id());

-- Sync errors table
CREATE TABLE IF NOT EXISTS public.qbo_sync_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    qbo_entity_id TEXT,
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    error_details JSONB DEFAULT '{}'::jsonb,
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS for sync errors
ALTER TABLE public.qbo_sync_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view sync errors in their tenant"
    ON public.qbo_sync_errors FOR SELECT
    USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

CREATE POLICY "System can manage sync errors"
    ON public.qbo_sync_errors FOR ALL
    USING (tenant_id = get_user_tenant_id());

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_qbo_payment_history_tenant ON public.qbo_payment_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_qbo_payment_history_project ON public.qbo_payment_history(project_id);
CREATE INDEX IF NOT EXISTS idx_qbo_payment_history_qbo_invoice ON public.qbo_payment_history(qbo_invoice_id);
CREATE INDEX IF NOT EXISTS idx_qbo_sync_errors_tenant ON public.qbo_sync_errors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_qbo_sync_errors_entity ON public.qbo_sync_errors(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_qbo_sync_errors_unresolved ON public.qbo_sync_errors(tenant_id, resolved_at) WHERE resolved_at IS NULL;