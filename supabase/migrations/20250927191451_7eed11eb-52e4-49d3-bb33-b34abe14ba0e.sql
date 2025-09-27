-- DocuSign Integration Database Schema

-- DocuSign account configurations per tenant
CREATE TABLE public.docusign_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_key TEXT NOT NULL,
  user_guid TEXT NOT NULL,
  rsa_private_key_id TEXT NOT NULL, -- Reference to secrets storage
  base_uri TEXT,
  account_id TEXT,
  hmac_secret_id TEXT, -- Reference to secrets storage
  brand_id TEXT,
  is_active BOOLEAN DEFAULT true,
  is_demo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id)
);

-- Template mappings between CRM smart docs and DocuSign templates
CREATE TABLE public.agreement_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  smart_doc_id UUID REFERENCES public.smart_docs(id) ON DELETE SET NULL,
  docusign_template_id TEXT NOT NULL,
  docgen_enabled BOOLEAN DEFAULT true,
  anchor_tag_strategy JSONB DEFAULT '{}',
  routing_order INTEGER DEFAULT 1,
  recipient_roles JSONB DEFAULT '[]', -- Array of role definitions
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, slug)
);

-- Agreement instances tracking envelope lifecycle
CREATE TABLE public.agreement_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  template_slug TEXT NOT NULL,
  envelope_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, sent, delivered, completed, declined, voided
  crm_object_type TEXT, -- contact, lead, job, project, estimate
  crm_object_id UUID,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  pipeline_entry_id UUID REFERENCES public.pipeline_entries(id) ON DELETE SET NULL,
  sender_user_id UUID REFERENCES auth.users(id),
  email_subject TEXT,
  envelope_custom_fields JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  sent_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Recipients for each agreement instance
CREATE TABLE public.recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  agreement_instance_id UUID NOT NULL REFERENCES public.agreement_instances(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- Signer1, Signer2, CC1, etc.
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  recipient_id TEXT, -- DocuSign recipient ID
  client_user_id TEXT, -- For embedded signing
  auth_type TEXT DEFAULT 'none', -- none, SMS, phone
  routing_order INTEGER DEFAULT 1,
  status TEXT DEFAULT 'created', -- created, sent, delivered, completed, declined, authentication_failed
  signed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Document Generation fields (dynamic tokens)
CREATE TABLE public.docgen_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  agreement_instance_id UUID NOT NULL REFERENCES public.agreement_instances(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(agreement_instance_id, field_key)
);

-- Event logging for webhook events
CREATE TABLE public.docusign_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  agreement_instance_id UUID REFERENCES public.agreement_instances(id) ON DELETE SET NULL,
  envelope_id TEXT,
  event_type TEXT NOT NULL, -- envelope_sent, envelope_delivered, envelope_completed, recipient_signed, etc.
  payload_json JSONB NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Extend documents table for signed PDFs
ALTER TABLE public.documents 
ADD COLUMN IF NOT EXISTS agreement_instance_id UUID REFERENCES public.agreement_instances(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS docusign_document_id TEXT,
ADD COLUMN IF NOT EXISTS is_signed_pdf BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS sha256_hash TEXT;

-- Enable RLS on all new tables
ALTER TABLE public.docusign_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.docgen_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.docusign_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage DocuSign accounts in their tenant" ON public.docusign_accounts
  FOR ALL USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage agreement templates in their tenant" ON public.agreement_templates
  FOR ALL USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

CREATE POLICY "Users can view agreement templates in their tenant" ON public.agreement_templates
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage agreement instances in their tenant" ON public.agreement_instances
  FOR ALL USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage recipients in their tenant" ON public.recipients
  FOR ALL USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage docgen fields in their tenant" ON public.docgen_fields
  FOR ALL USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view DocuSign events in their tenant" ON public.docusign_events
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert DocuSign events" ON public.docusign_events
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

-- Indexes for performance
CREATE INDEX idx_agreement_instances_envelope_id ON public.agreement_instances(envelope_id);
CREATE INDEX idx_agreement_instances_crm_object ON public.agreement_instances(crm_object_type, crm_object_id);
CREATE INDEX idx_agreement_instances_tenant_status ON public.agreement_instances(tenant_id, status);
CREATE INDEX idx_recipients_agreement_instance ON public.recipients(agreement_instance_id);
CREATE INDEX idx_docgen_fields_agreement_instance ON public.docgen_fields(agreement_instance_id);
CREATE INDEX idx_docusign_events_envelope_id ON public.docusign_events(envelope_id);
CREATE INDEX idx_documents_agreement_instance ON public.documents(agreement_instance_id) WHERE agreement_instance_id IS NOT NULL;

-- Helper function to get user tenant ID (if not exists)
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()),
    auth.uid()
  );
$$;