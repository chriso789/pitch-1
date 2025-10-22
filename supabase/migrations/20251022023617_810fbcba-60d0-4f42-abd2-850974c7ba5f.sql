-- Phase 1 Day 1: C-L-J Schema & Manager Approval Queue Setup (Revised)

-- ============================================
-- PART 1: Add C-L-J columns to pipeline_entries
-- ============================================
ALTER TABLE public.pipeline_entries
  ADD COLUMN IF NOT EXISTS contact_number INTEGER,
  ADD COLUMN IF NOT EXISTS lead_number INTEGER;

-- ============================================
-- PART 2: Add C-L-J columns to projects
-- ============================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS contact_number INTEGER,
  ADD COLUMN IF NOT EXISTS lead_number INTEGER,
  ADD COLUMN IF NOT EXISTS job_number INTEGER,
  ADD COLUMN IF NOT EXISTS clj_formatted_number TEXT;

-- ============================================
-- PART 3: Add clj_formatted_number to contacts
-- ============================================
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS clj_formatted_number TEXT;

-- ============================================
-- PART 4: Create indexes for C-L-J lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_contacts_contact_number 
  ON public.contacts(tenant_id, contact_number);

CREATE INDEX IF NOT EXISTS idx_contacts_clj_formatted 
  ON public.contacts(tenant_id, clj_formatted_number);

CREATE INDEX IF NOT EXISTS idx_pipeline_entries_clj_formatted 
  ON public.pipeline_entries(tenant_id, clj_formatted_number);

CREATE INDEX IF NOT EXISTS idx_projects_clj_formatted 
  ON public.projects(tenant_id, clj_formatted_number);

-- ============================================
-- PART 5: Enhance manager_approval_queue
-- ============================================
ALTER TABLE public.manager_approval_queue
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '7 days'),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id);

-- Create indexes for manager approval queue
CREATE INDEX IF NOT EXISTS idx_manager_approval_queue_tenant 
  ON public.manager_approval_queue(tenant_id);

CREATE INDEX IF NOT EXISTS idx_manager_approval_queue_status 
  ON public.manager_approval_queue(status);

CREATE INDEX IF NOT EXISTS idx_manager_approval_queue_pipeline 
  ON public.manager_approval_queue(pipeline_entry_id);

CREATE INDEX IF NOT EXISTS idx_manager_approval_queue_expires 
  ON public.manager_approval_queue(expires_at) 
  WHERE status = 'pending';