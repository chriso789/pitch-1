-- =========================================================
-- PERMIT EXPEDITER MODULE
-- =========================================================

BEGIN;

-- -----------------------------
-- 1) ENUMS
-- -----------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'jurisdiction_type') THEN
    CREATE TYPE jurisdiction_type AS ENUM ('COUNTY', 'CITY');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'portal_type') THEN
    CREATE TYPE portal_type AS ENUM ('ACCELA', 'ENERGOV', 'ETRAKIT', 'CUSTOM', 'UNKNOWN');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permit_case_status') THEN
    CREATE TYPE permit_case_status AS ENUM (
      'NOT_STARTED',
      'DRAFT_BUILT',
      'WAITING_ON_DOCS',
      'READY_TO_SUBMIT',
      'SUBMITTED',
      'IN_REVIEW',
      'CORRECTIONS_REQUIRED',
      'APPROVED',
      'REJECTED',
      'VOID'
    );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permit_event_type') THEN
    CREATE TYPE permit_event_type AS ENUM (
      'CREATED',
      'JURISDICTION_DETECTED',
      'TEMPLATE_SELECTED',
      'PROPERTY_DATA_FETCHED',
      'APPROVALS_LINKED',
      'CALCS_RUN',
      'APPLICATION_GENERATED',
      'PACKET_GENERATED',
      'SUBMITTED',
      'CORRECTION_NOTED',
      'APPROVED',
      'REJECTED',
      'ERROR'
    );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permit_doc_kind') THEN
    CREATE TYPE permit_doc_kind AS ENUM (
      'PERMIT_APPLICATION',
      'PERMIT_PACKET',
      'CHECKLIST',
      'NOTICE_OF_COMMENCEMENT',
      'PRODUCT_APPROVAL',
      'MEASUREMENT_REPORT',
      'OTHER'
    );
  END IF;
END $$;

-- -----------------------------
-- 2) PERMITTING AUTHORITIES DIRECTORY
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.permitting_authorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'FL',
  county_name TEXT NOT NULL,
  city_name TEXT NULL,
  jurisdiction_type jurisdiction_type NOT NULL,
  portal_type portal_type NOT NULL DEFAULT 'UNKNOWN',
  portal_url TEXT NULL,
  application_modes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  contact_email TEXT NULL,
  contact_phone TEXT NULL,
  contact_address TEXT NULL,
  office_hours TEXT NULL,
  default_required_attachments JSONB NOT NULL DEFAULT '[]'::JSONB,
  fee_structure JSONB NULL,
  processing_days_standard INTEGER NULL,
  processing_days_expedited INTEGER NULL,
  expedite_available BOOLEAN DEFAULT FALSE,
  expedite_requirements TEXT[] NULL,
  special_requirements TEXT[] NULL,
  notes TEXT NULL,
  boundary_geojson JSONB NULL,
  boundary_source TEXT NULL,
  boundary_version TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permitting_authorities_tenant ON public.permitting_authorities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_permitting_authorities_geo ON public.permitting_authorities(state, county_name, city_name);
CREATE INDEX IF NOT EXISTS idx_permitting_authorities_active ON public.permitting_authorities(tenant_id, is_active);

-- -----------------------------
-- 3) PERMIT APPLICATION TEMPLATES
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.permit_application_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  authority_id UUID NOT NULL REFERENCES public.permitting_authorities(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  permit_type TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  template_json JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, authority_id, template_key, version)
);

CREATE INDEX IF NOT EXISTS idx_permit_templates_tenant ON public.permit_application_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_permit_templates_authority ON public.permit_application_templates(authority_id);

-- -----------------------------
-- 4) PROPERTY PARCEL CACHE
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.property_parcel_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  county_name TEXT NOT NULL,
  parcel_id TEXT NULL,
  folio TEXT NULL,
  owner_name TEXT NULL,
  owner_mailing_address TEXT NULL,
  situs_address TEXT NULL,
  legal_description TEXT NULL,
  subdivision TEXT NULL,
  land_use TEXT NULL,
  year_built INTEGER NULL,
  assessed_value DECIMAL(12,2) NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, job_id, county_name)
);

CREATE INDEX IF NOT EXISTS idx_property_parcel_cache_tenant ON public.property_parcel_cache(tenant_id);
CREATE INDEX IF NOT EXISTS idx_property_parcel_cache_job ON public.property_parcel_cache(job_id);

-- -----------------------------
-- 5) EXTEND PRODUCTS TABLE FOR FL APPROVALS
-- -----------------------------

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS fl_product_approval_no TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS miami_dade_noa_no TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS approval_expires_on DATE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS extracted_approval_fields JSONB DEFAULT '{}'::JSONB;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS hvhz_approved BOOLEAN DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS requires_noa BOOLEAN DEFAULT FALSE;

-- -----------------------------
-- 6) PRODUCT APPROVAL DOCUMENTS
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.product_approval_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  approval_kind TEXT NOT NULL CHECK (approval_kind IN ('FL_PRODUCT_APPROVAL', 'MIAMI_DADE_NOA', 'TAS_TEST', 'ASTM', 'OTHER')),
  approval_number TEXT NOT NULL,
  revision TEXT NULL,
  expires_on DATE NULL,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  source_url TEXT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extracted_fields JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, product_id, approval_kind, approval_number)
);

CREATE INDEX IF NOT EXISTS idx_product_approval_docs_tenant ON public.product_approval_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_approval_docs_product ON public.product_approval_documents(product_id);

-- -----------------------------
-- 7) JOB MEASUREMENTS (Roofr/EagleView)
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.permit_job_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('ROOFR', 'EAGLEVIEW', 'MANUAL', 'AI_GENERATED')),
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_roof_area_sqft NUMERIC NULL,
  predominant_pitch TEXT NULL,
  squares NUMERIC NULL,
  stories INT NULL,
  eaves_ft NUMERIC NULL,
  rakes_ft NUMERIC NULL,
  ridges_ft NUMERIC NULL,
  valleys_ft NUMERIC NULL,
  hips_ft NUMERIC NULL,
  raw_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  report_bucket TEXT NULL,
  report_path TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, job_id, source)
);

CREATE INDEX IF NOT EXISTS idx_permit_job_measurements_tenant ON public.permit_job_measurements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_permit_job_measurements_job ON public.permit_job_measurements(job_id);

-- -----------------------------
-- 8) PERMIT CASES (Main Workflow)
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.permit_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  estimate_id UUID NULL,
  authority_id UUID NULL REFERENCES public.permitting_authorities(id) ON DELETE SET NULL,
  template_id UUID NULL REFERENCES public.permit_application_templates(id) ON DELETE SET NULL,
  status permit_case_status NOT NULL DEFAULT 'NOT_STARTED',
  state TEXT NOT NULL DEFAULT 'FL',
  county_name TEXT NULL,
  city_name TEXT NULL,
  jurisdiction_type jurisdiction_type NULL,
  application_field_values JSONB NOT NULL DEFAULT '{}'::JSONB,
  calculation_results JSONB NOT NULL DEFAULT '{}'::JSONB,
  missing_items JSONB NOT NULL DEFAULT '[]'::JSONB,
  validation_errors JSONB NOT NULL DEFAULT '[]'::JSONB,
  noc_required BOOLEAN NULL,
  noc_generated_at TIMESTAMPTZ NULL,
  noc_recorded_at TIMESTAMPTZ NULL,
  noc_instrument_number TEXT NULL,
  submitted_at TIMESTAMPTZ NULL,
  approved_at TIMESTAMPTZ NULL,
  permit_number TEXT NULL,
  fee_estimate DECIMAL(10,2) NULL,
  fee_actual DECIMAL(10,2) NULL,
  fee_paid BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ NULL,
  packet_url TEXT NULL,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permit_cases_tenant ON public.permit_cases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_permit_cases_job ON public.permit_cases(job_id);
CREATE INDEX IF NOT EXISTS idx_permit_cases_status ON public.permit_cases(tenant_id, status);

-- -----------------------------
-- 9) PERMIT CASE EVENTS (Audit Trail)
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.permit_case_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  permit_case_id UUID NOT NULL REFERENCES public.permit_cases(id) ON DELETE CASCADE,
  event_type permit_event_type NOT NULL,
  message TEXT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permit_case_events_tenant ON public.permit_case_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_permit_case_events_case ON public.permit_case_events(permit_case_id);

-- -----------------------------
-- 10) PERMIT DOCUMENTS (Generated PDFs)
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.permit_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  permit_case_id UUID NOT NULL REFERENCES public.permit_cases(id) ON DELETE CASCADE,
  kind permit_doc_kind NOT NULL,
  title TEXT NOT NULL,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size_bytes INTEGER NULL,
  meta JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permit_documents_tenant ON public.permit_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_permit_documents_case ON public.permit_documents(permit_case_id);

-- -----------------------------
-- 11) eRECORDING SUBMISSIONS (Simplifile)
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.erecord_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  permit_case_id UUID REFERENCES public.permit_cases(id) ON DELETE SET NULL,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('NOC', 'LIEN_RELEASE', 'SATISFACTION')),
  county_clerk_office TEXT NULL,
  submission_status TEXT DEFAULT 'pending' CHECK (submission_status IN (
    'pending', 'submitted', 'processing', 'recorded', 'rejected'
  )),
  simplifile_reference_id TEXT NULL,
  submitted_at TIMESTAMPTZ NULL,
  recorded_at TIMESTAMPTZ NULL,
  instrument_number TEXT NULL,
  book TEXT NULL,
  page TEXT NULL,
  recorded_document_url TEXT NULL,
  rejection_reason TEXT NULL,
  fee_amount DECIMAL(8,2) NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erecord_submissions_tenant ON public.erecord_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_erecord_submissions_permit ON public.erecord_submissions(permit_case_id);

-- -----------------------------
-- 12) TENANT eRECORDING CREDENTIALS
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.tenant_erecording_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'simplifile',
  account_id TEXT NULL,
  api_key_encrypted TEXT NULL,
  test_mode BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider)
);

-- -----------------------------
-- 13) UPDATED_AT TRIGGERS
-- -----------------------------

CREATE OR REPLACE FUNCTION public.permit_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_permitting_authorities_updated_at ON public.permitting_authorities;
CREATE TRIGGER trg_permitting_authorities_updated_at
BEFORE UPDATE ON public.permitting_authorities
FOR EACH ROW EXECUTE FUNCTION public.permit_set_updated_at();

DROP TRIGGER IF EXISTS trg_permit_application_templates_updated_at ON public.permit_application_templates;
CREATE TRIGGER trg_permit_application_templates_updated_at
BEFORE UPDATE ON public.permit_application_templates
FOR EACH ROW EXECUTE FUNCTION public.permit_set_updated_at();

DROP TRIGGER IF EXISTS trg_property_parcel_cache_updated_at ON public.property_parcel_cache;
CREATE TRIGGER trg_property_parcel_cache_updated_at
BEFORE UPDATE ON public.property_parcel_cache
FOR EACH ROW EXECUTE FUNCTION public.permit_set_updated_at();

DROP TRIGGER IF EXISTS trg_product_approval_documents_updated_at ON public.product_approval_documents;
CREATE TRIGGER trg_product_approval_documents_updated_at
BEFORE UPDATE ON public.product_approval_documents
FOR EACH ROW EXECUTE FUNCTION public.permit_set_updated_at();

DROP TRIGGER IF EXISTS trg_permit_job_measurements_updated_at ON public.permit_job_measurements;
CREATE TRIGGER trg_permit_job_measurements_updated_at
BEFORE UPDATE ON public.permit_job_measurements
FOR EACH ROW EXECUTE FUNCTION public.permit_set_updated_at();

DROP TRIGGER IF EXISTS trg_permit_cases_updated_at ON public.permit_cases;
CREATE TRIGGER trg_permit_cases_updated_at
BEFORE UPDATE ON public.permit_cases
FOR EACH ROW EXECUTE FUNCTION public.permit_set_updated_at();

DROP TRIGGER IF EXISTS trg_erecord_submissions_updated_at ON public.erecord_submissions;
CREATE TRIGGER trg_erecord_submissions_updated_at
BEFORE UPDATE ON public.erecord_submissions
FOR EACH ROW EXECUTE FUNCTION public.permit_set_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_erecording_credentials_updated_at ON public.tenant_erecording_credentials;
CREATE TRIGGER trg_tenant_erecording_credentials_updated_at
BEFORE UPDATE ON public.tenant_erecording_credentials
FOR EACH ROW EXECUTE FUNCTION public.permit_set_updated_at();

-- -----------------------------
-- 14) ROW LEVEL SECURITY
-- -----------------------------

ALTER TABLE public.permitting_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_application_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_parcel_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_approval_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_job_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erecord_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_erecording_credentials ENABLE ROW LEVEL SECURITY;

-- Permitting Authorities policies
DROP POLICY IF EXISTS permitting_authorities_select ON public.permitting_authorities;
CREATE POLICY permitting_authorities_select ON public.permitting_authorities
FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS permitting_authorities_insert ON public.permitting_authorities;
CREATE POLICY permitting_authorities_insert ON public.permitting_authorities
FOR INSERT WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS permitting_authorities_update ON public.permitting_authorities;
CREATE POLICY permitting_authorities_update ON public.permitting_authorities
FOR UPDATE USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS permitting_authorities_delete ON public.permitting_authorities;
CREATE POLICY permitting_authorities_delete ON public.permitting_authorities
FOR DELETE USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

-- Permit Application Templates policies
DROP POLICY IF EXISTS permit_templates_select ON public.permit_application_templates;
CREATE POLICY permit_templates_select ON public.permit_application_templates
FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS permit_templates_all ON public.permit_application_templates;
CREATE POLICY permit_templates_all ON public.permit_application_templates
FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

-- Property Parcel Cache policies
DROP POLICY IF EXISTS property_parcel_cache_select ON public.property_parcel_cache;
CREATE POLICY property_parcel_cache_select ON public.property_parcel_cache
FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS property_parcel_cache_all ON public.property_parcel_cache;
CREATE POLICY property_parcel_cache_all ON public.property_parcel_cache
FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

-- Product Approval Documents policies
DROP POLICY IF EXISTS product_approval_docs_select ON public.product_approval_documents;
CREATE POLICY product_approval_docs_select ON public.product_approval_documents
FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS product_approval_docs_all ON public.product_approval_documents;
CREATE POLICY product_approval_docs_all ON public.product_approval_documents
FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

-- Permit Job Measurements policies
DROP POLICY IF EXISTS permit_job_measurements_select ON public.permit_job_measurements;
CREATE POLICY permit_job_measurements_select ON public.permit_job_measurements
FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS permit_job_measurements_all ON public.permit_job_measurements;
CREATE POLICY permit_job_measurements_all ON public.permit_job_measurements
FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

-- Permit Cases policies
DROP POLICY IF EXISTS permit_cases_select ON public.permit_cases;
CREATE POLICY permit_cases_select ON public.permit_cases
FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS permit_cases_all ON public.permit_cases;
CREATE POLICY permit_cases_all ON public.permit_cases
FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

-- Permit Case Events policies
DROP POLICY IF EXISTS permit_case_events_select ON public.permit_case_events;
CREATE POLICY permit_case_events_select ON public.permit_case_events
FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS permit_case_events_all ON public.permit_case_events;
CREATE POLICY permit_case_events_all ON public.permit_case_events
FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

-- Permit Documents policies
DROP POLICY IF EXISTS permit_documents_select ON public.permit_documents;
CREATE POLICY permit_documents_select ON public.permit_documents
FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS permit_documents_all ON public.permit_documents;
CREATE POLICY permit_documents_all ON public.permit_documents
FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

-- eRecord Submissions policies
DROP POLICY IF EXISTS erecord_submissions_select ON public.erecord_submissions;
CREATE POLICY erecord_submissions_select ON public.erecord_submissions
FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS erecord_submissions_all ON public.erecord_submissions;
CREATE POLICY erecord_submissions_all ON public.erecord_submissions
FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

-- Tenant eRecording Credentials policies
DROP POLICY IF EXISTS tenant_erecording_creds_select ON public.tenant_erecording_credentials;
CREATE POLICY tenant_erecording_creds_select ON public.tenant_erecording_credentials
FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

DROP POLICY IF EXISTS tenant_erecording_creds_all ON public.tenant_erecording_credentials;
CREATE POLICY tenant_erecording_creds_all ON public.tenant_erecording_credentials
FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  OR tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
);

COMMIT;