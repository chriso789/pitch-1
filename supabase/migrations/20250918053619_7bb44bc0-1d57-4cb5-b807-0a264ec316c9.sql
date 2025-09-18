-- SMART DOCS Database Schema - Phase 1 (Fixed): Core Templates & Infrastructure
-- Create enums for Smart Docs (check if they exist first)
DO $$ BEGIN
    CREATE TYPE smartdoc_template_type AS ENUM ('DOCUMENT', 'EMAIL', 'PRINT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE smartdoc_context_type AS ENUM ('CONTACT', 'LEAD', 'PROJECT', 'ESTIMATE', 'INVOICE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE smartdoc_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE smartdoc_engine AS ENUM ('HTML', 'DOCX', 'PDF_FORM');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE smartdoc_output_type AS ENUM ('PDF', 'DOCX', 'HTML');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE smartdoc_render_status AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE smartdoc_sign_status AS ENUM ('PENDING', 'COMPLETED', 'DECLINED', 'VOID');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE smartdoc_sign_provider AS ENUM ('DOCUSIGN', 'NATIVE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Main template table
CREATE TABLE IF NOT EXISTS public.smartdoc_templates (
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
CREATE TABLE IF NOT EXISTS public.smartdoc_template_versions (
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
CREATE TABLE IF NOT EXISTS public.smartdoc_blocks (
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
CREATE TABLE IF NOT EXISTS public.smartdoc_assets (
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
CREATE TABLE IF NOT EXISTS public.smartdoc_tag_catalog (
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