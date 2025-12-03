-- Fix profiles.active_tenant_id to SET NULL on delete (user can re-select their active company)
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_active_tenant_id_fkey;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_active_tenant_id_fkey 
FOREIGN KEY (active_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

-- Add missing CASCADE FK constraints to critical tables (only tables with tenant_id column)

-- enhanced_estimates
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enhanced_estimates_tenant_id_fkey') THEN
    ALTER TABLE public.enhanced_estimates
    ADD CONSTRAINT enhanced_estimates_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- locations
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_tenant_id_fkey') THEN
    ALTER TABLE public.locations
    ADD CONSTRAINT locations_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- jobs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_tenant_id_fkey') THEN
    ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- crews
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crews_tenant_id_fkey') THEN
    ALTER TABLE public.crews
    ADD CONSTRAINT crews_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- pipeline_stages
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_tenant_id_fkey') THEN
    ALTER TABLE public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- pipeline_entries
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_entries_tenant_id_fkey') THEN
    ALTER TABLE public.pipeline_entries
    ADD CONSTRAINT pipeline_entries_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- contacts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_tenant_id_fkey') THEN
    ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- projects
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_tenant_id_fkey') THEN
    ALTER TABLE public.projects
    ADD CONSTRAINT projects_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- documents
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_tenant_id_fkey') THEN
    ALTER TABLE public.documents
    ADD CONSTRAINT documents_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- user_company_access
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_company_access_tenant_id_fkey') THEN
    ALTER TABLE public.user_company_access
    ADD CONSTRAINT user_company_access_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;