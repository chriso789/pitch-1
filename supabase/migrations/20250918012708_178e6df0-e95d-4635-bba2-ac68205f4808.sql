-- PITCH Database Schema - Complete Implementation
-- Phase 1: Core enums and types
CREATE TYPE public.app_role AS ENUM ('master', 'admin', 'manager', 'rep', 'user');
CREATE TYPE public.contact_type AS ENUM ('homeowner', 'contractor', 'supplier', 'inspector', 'other');
CREATE TYPE public.lead_source AS ENUM ('referral', 'canvassing', 'online', 'advertisement', 'social_media', 'other');
CREATE TYPE public.pipeline_status AS ENUM ('lead', 'legal_review', 'contingency_signed', 'project', 'completed', 'closed', 'lost', 'canceled', 'duplicate');
CREATE TYPE public.roof_type AS ENUM ('shingle', 'metal', 'tile', 'flat', 'slate', 'cedar', 'other');
CREATE TYPE public.estimate_status AS ENUM ('draft', 'preview', 'sent', 'approved', 'rejected', 'expired');
CREATE TYPE public.payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded', 'canceled');
CREATE TYPE public.commission_type AS ENUM ('gross_percent', 'net_percent', 'tiered_margin', 'flat_fee');
CREATE TYPE public.outbox_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'canceled');

-- Tenants (multi-tenant support)
CREATE TABLE public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    subdomain TEXT UNIQUE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tenant settings for portal visibility and profit policies
CREATE TABLE public.tenant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    min_profit_margin_percent DECIMAL(5,2) DEFAULT 15.00,
    min_profit_amount_dollars DECIMAL(10,2) DEFAULT 1000.00,
    default_target_margin_percent DECIMAL(5,2) DEFAULT 30.00,
    portal_show_photos BOOLEAN DEFAULT true,
    portal_show_documents BOOLEAN DEFAULT true,
    portal_show_balance BOOLEAN DEFAULT true,
    portal_show_messages BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id)
);

-- User profiles (extends auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    role app_role DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Contacts
CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    type contact_type DEFAULT 'homeowner',
    first_name TEXT,
    last_name TEXT,
    company_name TEXT,
    email TEXT,
    phone TEXT,
    address_street TEXT,
    address_city TEXT,
    address_state TEXT,
    address_zip TEXT,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    notes TEXT,
    tags TEXT[],
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Leads/Pipeline
CREATE TABLE public.pipeline_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
    status pipeline_status DEFAULT 'lead',
    source lead_source,
    roof_type roof_type,
    priority TEXT DEFAULT 'medium', -- high, medium, low
    estimated_value DECIMAL(12,2),
    probability_percent INTEGER DEFAULT 50,
    expected_close_date DATE,
    assigned_to UUID REFERENCES public.profiles(id),
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Projects (when pipeline_entries convert)
CREATE TABLE public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    pipeline_entry_id UUID REFERENCES public.pipeline_entries(id),
    project_number TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    start_date DATE,
    estimated_completion_date DATE,
    actual_completion_date DATE,
    project_manager_id UUID REFERENCES public.profiles(id),
    status TEXT DEFAULT 'active', -- active, on_hold, completed, canceled
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Supplier Pricebooks
CREATE TABLE public.supplier_pricebooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    supplier_name TEXT NOT NULL,
    item_code TEXT NOT NULL,
    item_description TEXT,
    category TEXT,
    unit_of_measure TEXT,
    unit_cost DECIMAL(10,4),
    markup_percent DECIMAL(5,2) DEFAULT 0,
    effective_date DATE DEFAULT CURRENT_DATE,
    expires_date DATE,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    imported_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, supplier_name, item_code, effective_date)
);

-- Estimate Templates
CREATE TABLE public.estimate_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    roof_type roof_type NOT NULL,
    template_data JSONB NOT NULL, -- Contains parameters, materials, labor, formulas
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, name)
);

-- Estimates
CREATE TABLE public.estimates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    pipeline_entry_id UUID REFERENCES public.pipeline_entries(id),
    template_id UUID REFERENCES public.estimate_templates(id),
    estimate_number TEXT UNIQUE,
    status estimate_status DEFAULT 'draft',
    parameters JSONB DEFAULT '{}', -- roof dimensions, parameters
    line_items JSONB DEFAULT '[]', -- materials and labor breakdown
    material_cost DECIMAL(12,2) DEFAULT 0,
    labor_cost DECIMAL(12,2) DEFAULT 0,
    overhead_percent DECIMAL(5,2) DEFAULT 0,
    overhead_amount DECIMAL(12,2) DEFAULT 0,
    target_margin_percent DECIMAL(5,2) DEFAULT 30,
    selling_price DECIMAL(12,2) DEFAULT 0,
    actual_profit DECIMAL(12,2) DEFAULT 0,
    actual_margin_percent DECIMAL(5,2) DEFAULT 0,
    valid_until DATE,
    sent_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Budget Snapshots (immutable once project starts)
CREATE TABLE public.project_budget_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    estimate_id UUID REFERENCES public.estimates(id),
    snapshot_date TIMESTAMPTZ DEFAULT now(),
    original_budget JSONB NOT NULL, -- Complete estimate at approval time
    is_current BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Project Costs (actuals vs budget)
CREATE TABLE public.project_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    cost_type TEXT NOT NULL, -- 'material', 'labor', 'equipment', 'permit', 'other'
    description TEXT NOT NULL,
    quantity DECIMAL(10,3),
    unit_cost DECIMAL(10,4),
    total_cost DECIMAL(12,2) NOT NULL,
    vendor_name TEXT,
    invoice_number TEXT,
    cost_date DATE DEFAULT CURRENT_DATE,
    is_change_order BOOLEAN DEFAULT false,
    notes TEXT,
    receipt_url TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Rep Overhead Rules
CREATE TABLE public.rep_overhead_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    rep_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    overhead_percent DECIMAL(5,2) NOT NULL,
    effective_date DATE DEFAULT CURRENT_DATE,
    expires_date DATE,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Commission Plans
CREATE TABLE public.commission_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    commission_type commission_type NOT NULL,
    plan_config JSONB NOT NULL, -- Stores rates, tiers, rules
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, name)
);

-- User Commission Plan Assignments
CREATE TABLE public.user_commission_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    commission_plan_id UUID REFERENCES public.commission_plans(id) ON DELETE CASCADE,
    effective_date DATE DEFAULT CURRENT_DATE,
    expires_date DATE,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Outbox Pattern for Integrations
CREATE TABLE public.outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- 'quickbooks.invoice', 'stripe.payment', etc.
    aggregate_id UUID NOT NULL, -- ID of the entity (project, payment, etc.)
    payload JSONB NOT NULL,
    status outbox_status DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Idempotency Keys for API calls
CREATE TABLE public.idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_data JSONB,
    status_code INTEGER,
    expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours'),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, key)
);

-- Payments
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id),
    estimate_id UUID REFERENCES public.estimates(id),
    payment_number TEXT UNIQUE,
    amount DECIMAL(12,2) NOT NULL,
    status payment_status DEFAULT 'pending',
    payment_method TEXT, -- 'card', 'ach', 'check', 'cash'
    provider_payment_id TEXT, -- Stripe payment intent ID
    provider_name TEXT DEFAULT 'stripe',
    customer_email TEXT,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    processed_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Homeowner Portal Access
CREATE TABLE public.portal_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
    access_token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days'),
    is_active BOOLEAN DEFAULT true,
    granted_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Documents and Photos
CREATE TABLE public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id),
    contact_id UUID REFERENCES public.contacts(id),
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    document_type TEXT, -- 'contract', 'photo', 'invoice', 'permit', 'other'
    is_visible_to_homeowner BOOLEAN DEFAULT false,
    description TEXT,
    uploaded_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Audit Trail
CREATE TABLE public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    action TEXT NOT NULL, -- INSERT, UPDATE, DELETE
    old_values JSONB,
    new_values JSONB,
    changed_by UUID REFERENCES public.profiles(id),
    changed_at TIMESTAMPTZ DEFAULT now(),
    ip_address INET,
    user_agent TEXT
);

-- Create indexes for performance
CREATE INDEX idx_contacts_tenant_id ON public.contacts(tenant_id);
CREATE INDEX idx_contacts_email ON public.contacts(email);
CREATE INDEX idx_contacts_phone ON public.contacts(phone);
CREATE INDEX idx_contacts_location ON public.contacts(latitude, longitude);

CREATE INDEX idx_pipeline_tenant_id ON public.pipeline_entries(tenant_id);
CREATE INDEX idx_pipeline_status ON public.pipeline_entries(status);
CREATE INDEX idx_pipeline_assigned_to ON public.pipeline_entries(assigned_to);
CREATE INDEX idx_pipeline_created_at ON public.pipeline_entries(created_at);

CREATE INDEX idx_projects_tenant_id ON public.projects(tenant_id);
CREATE INDEX idx_projects_status ON public.projects(status);
CREATE INDEX idx_projects_manager ON public.projects(project_manager_id);

CREATE INDEX idx_estimates_tenant_id ON public.estimates(tenant_id);
CREATE INDEX idx_estimates_status ON public.estimates(status);
CREATE INDEX idx_estimates_pipeline ON public.estimates(pipeline_entry_id);

CREATE INDEX idx_project_costs_tenant_id ON public.project_costs(tenant_id);
CREATE INDEX idx_project_costs_project_id ON public.project_costs(project_id);
CREATE INDEX idx_project_costs_date ON public.project_costs(cost_date);

CREATE INDEX idx_outbox_status ON public.outbox_events(status);
CREATE INDEX idx_outbox_retry ON public.outbox_events(next_retry_at) WHERE status = 'failed';
CREATE INDEX idx_outbox_tenant_id ON public.outbox_events(tenant_id);

CREATE INDEX idx_payments_tenant_id ON public.payments(tenant_id);
CREATE INDEX idx_payments_status ON public.payments(status);
CREATE INDEX idx_payments_project_id ON public.payments(project_id);

CREATE INDEX idx_audit_tenant_id ON public.audit_log(tenant_id);
CREATE INDEX idx_audit_table_record ON public.audit_log(table_name, record_id);
CREATE INDEX idx_audit_changed_at ON public.audit_log(changed_at);

-- Enable Row Level Security on all tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_pricebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_budget_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rep_overhead_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_commission_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;