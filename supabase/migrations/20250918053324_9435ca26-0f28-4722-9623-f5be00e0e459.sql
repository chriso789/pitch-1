-- SMART DOCS Database Schema - Phase 1: Core Templates & Infrastructure
-- Create enums for Smart Docs
CREATE TYPE smartdoc_template_type AS ENUM ('DOCUMENT', 'EMAIL', 'PRINT');
CREATE TYPE smartdoc_context_type AS ENUM ('CONTACT', 'LEAD', 'PROJECT', 'ESTIMATE', 'INVOICE');
CREATE TYPE smartdoc_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE smartdoc_engine AS ENUM ('HTML', 'DOCX', 'PDF_FORM');
CREATE TYPE smartdoc_output_type AS ENUM ('PDF', 'DOCX', 'HTML');
CREATE TYPE smartdoc_render_status AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE smartdoc_sign_status AS ENUM ('PENDING', 'COMPLETED', 'DECLINED', 'VOID');
CREATE TYPE smartdoc_sign_provider AS ENUM ('DOCUSIGN', 'NATIVE');

-- Main template table
CREATE TABLE public.smartdoc_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  type smartdoc_template_type NOT NULL DEFAULT 'DOCUMENT',
  default_context smartdoc_context_type NOT NULL DEFAULT 'PROJECT',
  status smartdoc_status NOT NULL DEFAULT 'DRAFT',
  folder_id UUID, -- For organization
  description TEXT,
  is_homeowner_visible BOOLEAN DEFAULT false,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Template versions for change tracking
CREATE TABLE public.smartdoc_template_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  template_id UUID NOT NULL REFERENCES public.smartdoc_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  schema JSONB NOT NULL, -- Compiled template descriptor
  engine smartdoc_engine NOT NULL DEFAULT 'HTML',
  published_by UUID,
  published_at TIMESTAMP WITH TIME ZONE,
  changelog TEXT,
  is_latest BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Reusable template blocks
CREATE TABLE public.smartdoc_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  block_type TEXT NOT NULL, -- 'header', 'footer', 'photo_grid', 'about_us', etc.
  content JSONB NOT NULL, -- Block definition
  is_global BOOLEAN DEFAULT false, -- Available to all templates in tenant
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Asset management for templates
CREATE TABLE public.smartdoc_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  s3_key TEXT NOT NULL, -- S3 storage reference
  content_type TEXT NOT NULL,
  file_size INTEGER,
  width INTEGER, -- For images
  height INTEGER, -- For images
  hash TEXT, -- For cache busting
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tag catalog for autocomplete and validation
CREATE TABLE public.smartdoc_tag_catalog (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID, -- NULL for global tags
  name TEXT NOT NULL, -- e.g., 'contact.full_name'
  description TEXT NOT NULL,
  example_value TEXT,
  context_type smartdoc_context_type NOT NULL,
  is_sensitive BOOLEAN DEFAULT false, -- Commission, internal costs, etc.
  transform_support TEXT[], -- Supported transforms like 'currency', 'date'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Document renditions (past renders)
CREATE TABLE public.smartdoc_renditions (
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
CREATE TABLE public.smartdoc_sign_envelopes (
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
CREATE TABLE public.smartdoc_share_rules (
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
CREATE TABLE public.smartdoc_folders (
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