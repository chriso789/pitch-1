-- SMART DOCS Database Schema - Phase 2: Remaining Tables, RLS & Indexes

-- Document renditions (past renders)
CREATE TABLE IF NOT EXISTS public.smartdoc_renditions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  template_id UUID NOT NULL REFERENCES public.smartdoc_templates(id),
  template_version_id UUID NOT NULL REFERENCES public.smartdoc_template_versions(id),
  context_type smartdoc_context_type NOT NULL,
  context_id UUID NOT NULL, -- ID of the contact/project/estimate/etc.
  output_type smartdoc_output_type NOT NULL,
  render_ms INTEGER, -- Performance tracking
  file_size INTEGER,
  status smartdoc_render_status NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  s3_key TEXT, -- Final rendered document
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- E-signature envelopes
CREATE TABLE IF NOT EXISTS public.smartdoc_sign_envelopes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  rendition_id UUID NOT NULL REFERENCES public.smartdoc_renditions(id),
  provider smartdoc_sign_provider NOT NULL,
  envelope_id TEXT, -- Provider's envelope ID
  signer_roles JSONB NOT NULL, -- Signer definitions and status
  status smartdoc_sign_status NOT NULL DEFAULT 'PENDING',
  signing_url TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Portal sharing rules
CREATE TABLE IF NOT EXISTS public.smartdoc_share_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  template_id UUID REFERENCES public.smartdoc_templates(id),
  rendition_id UUID REFERENCES public.smartdoc_renditions(id),
  is_portal_visible BOOLEAN DEFAULT false,
  require_auth BOOLEAN DEFAULT true,
  watermark_text TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Template folders for organization
CREATE TABLE IF NOT EXISTS public.smartdoc_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.smartdoc_folders(id),
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.smartdoc_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smartdoc_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smartdoc_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smartdoc_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smartdoc_tag_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smartdoc_renditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smartdoc_sign_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smartdoc_share_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smartdoc_folders ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for Smart Docs
-- Templates
CREATE POLICY "Users can view templates in their tenant" ON public.smartdoc_templates
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage templates in their tenant" ON public.smartdoc_templates
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Template versions
CREATE POLICY "Users can view template versions in their tenant" ON public.smartdoc_template_versions
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage template versions in their tenant" ON public.smartdoc_template_versions
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Blocks
CREATE POLICY "Users can view blocks in their tenant" ON public.smartdoc_blocks
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage blocks in their tenant" ON public.smartdoc_blocks
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Assets
CREATE POLICY "Users can view assets in their tenant" ON public.smartdoc_assets
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage assets in their tenant" ON public.smartdoc_assets
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Tag catalog (global and tenant-specific)
CREATE POLICY "Users can view tag catalog" ON public.smartdoc_tag_catalog
  FOR SELECT USING (tenant_id IS NULL OR tenant_id = get_user_tenant_id());

CREATE POLICY "Masters can manage global tag catalog" ON public.smartdoc_tag_catalog
  FOR ALL USING (tenant_id IS NULL AND has_role('master'::app_role));

CREATE POLICY "Admins can manage tenant tag catalog" ON public.smartdoc_tag_catalog
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Renditions
CREATE POLICY "Users can view renditions in their tenant" ON public.smartdoc_renditions
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create renditions in their tenant" ON public.smartdoc_renditions
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage renditions in their tenant" ON public.smartdoc_renditions
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Sign envelopes
CREATE POLICY "Users can view sign envelopes in their tenant" ON public.smartdoc_sign_envelopes
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create sign envelopes in their tenant" ON public.smartdoc_sign_envelopes
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage sign envelopes in their tenant" ON public.smartdoc_sign_envelopes
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Share rules
CREATE POLICY "Users can view share rules in their tenant" ON public.smartdoc_share_rules
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage share rules in their tenant" ON public.smartdoc_share_rules
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Folders
CREATE POLICY "Users can view folders in their tenant" ON public.smartdoc_folders
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage folders in their tenant" ON public.smartdoc_folders
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));