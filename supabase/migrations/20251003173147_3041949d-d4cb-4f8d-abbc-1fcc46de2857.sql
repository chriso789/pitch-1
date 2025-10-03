-- QBO Complete Schema Migration
-- Phase 1: Core QBO tables, RPCs, and indexes

-- =====================================================
-- 1. QBO Connections Table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.qbo_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    realm_id TEXT NOT NULL,
    qbo_company_name TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, realm_id)
);

ALTER TABLE public.qbo_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view QBO connections in their tenant"
    ON public.qbo_connections FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage QBO connections in their tenant"
    ON public.qbo_connections FOR ALL
    USING (
        tenant_id = get_user_tenant_id() AND
        has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role])
    );

CREATE INDEX idx_qbo_connections_tenant_realm ON public.qbo_connections(tenant_id, realm_id, is_active);

-- =====================================================
-- 2. QBO Entity Mapping Table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.qbo_entity_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    realm_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    qbo_entity_id TEXT NOT NULL,
    qbo_entity_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, entity_type, entity_id, realm_id)
);

ALTER TABLE public.qbo_entity_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view entity mappings in their tenant"
    ON public.qbo_entity_mapping FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage entity mappings"
    ON public.qbo_entity_mapping FOR ALL
    USING (tenant_id = get_user_tenant_id());

CREATE INDEX idx_qbo_entity_mapping_lookup ON public.qbo_entity_mapping(tenant_id, entity_type, entity_id);
CREATE INDEX idx_qbo_entity_mapping_reverse ON public.qbo_entity_mapping(tenant_id, realm_id, qbo_entity_id);

-- =====================================================
-- 3. QBO Webhook Journal Table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.qbo_webhook_journal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    realm_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_time TIMESTAMPTZ NOT NULL,
    event_id TEXT,
    entities JSONB NOT NULL DEFAULT '[]',
    processed_at TIMESTAMPTZ,
    processing_status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.qbo_webhook_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view webhook journal in their tenant"
    ON public.qbo_webhook_journal FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert webhook events"
    ON public.qbo_webhook_journal FOR INSERT
    WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "System can update webhook events"
    ON public.qbo_webhook_journal FOR UPDATE
    USING (tenant_id = get_user_tenant_id());

CREATE INDEX idx_qbo_webhook_journal_realm ON public.qbo_webhook_journal(realm_id, processed_at);
CREATE INDEX idx_qbo_webhook_journal_status ON public.qbo_webhook_journal(processing_status, created_at);

-- =====================================================
-- 4. Job Type Item Mapping Table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.job_type_item_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    realm_id TEXT NOT NULL,
    job_type_code TEXT NOT NULL,
    qbo_item_id TEXT NOT NULL,
    qbo_item_name TEXT,
    qbo_class_id TEXT,
    qbo_class_name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, realm_id, job_type_code)
);

ALTER TABLE public.job_type_item_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view job type mappings in their tenant"
    ON public.job_type_item_map FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage job type mappings"
    ON public.job_type_item_map FOR ALL
    USING (
        tenant_id = get_user_tenant_id() AND
        has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role])
    );

CREATE INDEX idx_job_type_item_map_lookup ON public.job_type_item_map(tenant_id, realm_id, job_type_code, is_active);

-- =====================================================
-- 5. QBO Location to Department Mapping
-- =====================================================
CREATE TABLE IF NOT EXISTS public.qbo_location_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    realm_id TEXT NOT NULL,
    location_id UUID NOT NULL,
    qbo_department_id TEXT NOT NULL,
    department_name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, realm_id, location_id)
);

ALTER TABLE public.qbo_location_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view location mappings in their tenant"
    ON public.qbo_location_map FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage location mappings"
    ON public.qbo_location_map FOR ALL
    USING (
        tenant_id = get_user_tenant_id() AND
        has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role])
    );

CREATE INDEX idx_qbo_location_map_lookup ON public.qbo_location_map(tenant_id, realm_id, location_id, is_active);

-- =====================================================
-- 6. RPCs for QBO Worker Operations
-- =====================================================

CREATE OR REPLACE FUNCTION public.api_qbo_set_connection(
    p_realm_id TEXT,
    p_access_token TEXT,
    p_refresh_token TEXT,
    p_expires_at TIMESTAMPTZ,
    p_scopes TEXT[],
    p_company_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_connection_id UUID;
    v_tenant_id UUID;
BEGIN
    v_tenant_id := get_user_tenant_id();
    
    INSERT INTO public.qbo_connections (
        tenant_id, realm_id, qbo_company_name, access_token, refresh_token,
        expires_at, scopes, is_active, connected_at
    ) VALUES (
        v_tenant_id, p_realm_id, p_company_name, p_access_token, p_refresh_token,
        p_expires_at, p_scopes, true, now()
    )
    ON CONFLICT (tenant_id, realm_id)
    DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        scopes = EXCLUDED.scopes,
        qbo_company_name = COALESCE(EXCLUDED.qbo_company_name, qbo_connections.qbo_company_name),
        is_active = true,
        updated_at = now()
    RETURNING id INTO v_connection_id;
    
    RETURN v_connection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_qbo_map_job_invoice(
    p_job_id UUID,
    p_realm_id TEXT,
    p_qbo_invoice_id TEXT,
    p_doc_number TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mapping_id UUID;
    v_tenant_id UUID;
BEGIN
    v_tenant_id := get_user_tenant_id();
    
    INSERT INTO public.qbo_entity_mapping (
        tenant_id, realm_id, entity_type, entity_id,
        qbo_entity_id, qbo_entity_type, metadata
    ) VALUES (
        v_tenant_id, p_realm_id, 'job', p_job_id,
        p_qbo_invoice_id, 'Invoice', jsonb_build_object('doc_number', p_doc_number)
    )
    ON CONFLICT (tenant_id, entity_type, entity_id, realm_id)
    DO UPDATE SET
        qbo_entity_id = EXCLUDED.qbo_entity_id,
        metadata = EXCLUDED.metadata,
        updated_at = now()
    RETURNING id INTO v_mapping_id;
    
    RETURN v_mapping_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_qbo_update_invoice_mirror(
    p_realm_id TEXT,
    p_qbo_invoice_id TEXT,
    p_doc_number TEXT,
    p_total NUMERIC,
    p_balance NUMERIC,
    p_status TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mirror_id UUID;
    v_tenant_id UUID;
BEGIN
    v_tenant_id := get_user_tenant_id();
    
    INSERT INTO public.invoice_ar_mirror (
        tenant_id, realm_id, qbo_invoice_id, doc_number,
        total_amount, balance, status, last_pulled_at
    ) VALUES (
        v_tenant_id, p_realm_id, p_qbo_invoice_id, p_doc_number,
        p_total, p_balance, COALESCE(p_status, 'Unpaid'), now()
    )
    ON CONFLICT (realm_id, qbo_invoice_id)
    DO UPDATE SET
        doc_number = EXCLUDED.doc_number,
        total_amount = EXCLUDED.total_amount,
        balance = EXCLUDED.balance,
        status = COALESCE(EXCLUDED.status, invoice_ar_mirror.status),
        last_pulled_at = now(),
        updated_at = now()
    RETURNING id INTO v_mirror_id;
    
    RETURN v_mirror_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_qbo_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER update_qbo_connections_updated_at
    BEFORE UPDATE ON public.qbo_connections
    FOR EACH ROW
    EXECUTE FUNCTION public.update_qbo_updated_at();

CREATE TRIGGER update_qbo_entity_mapping_updated_at
    BEFORE UPDATE ON public.qbo_entity_mapping
    FOR EACH ROW
    EXECUTE FUNCTION public.update_qbo_updated_at();

CREATE TRIGGER update_job_type_item_map_updated_at
    BEFORE UPDATE ON public.job_type_item_map
    FOR EACH ROW
    EXECUTE FUNCTION public.update_qbo_updated_at();

CREATE TRIGGER update_qbo_location_map_updated_at
    BEFORE UPDATE ON public.qbo_location_map
    FOR EACH ROW
    EXECUTE FUNCTION public.update_qbo_updated_at();