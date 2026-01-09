-- ============================================================
-- MULTI-TENANT HARDENING MIGRATION (PART 2)
-- RPC Functions with correct view columns
-- ============================================================

-- Get all companies user belongs to
CREATE OR REPLACE FUNCTION public.get_crew_user_companies()
RETURNS TABLE (
  company_id uuid,
  company_name text,
  role text,
  is_active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT 
    cu.company_id,
    t.name as company_name,
    cu.role::text,
    cu.is_active
  FROM crew.company_users cu
  JOIN tenants t ON t.id = cu.company_id
  WHERE cu.user_id = auth.uid()
    AND cu.is_active = true
  ORDER BY t.name
$$;

-- Update dashboard jobs RPC to accept company filter (using actual view columns)
CREATE OR REPLACE FUNCTION public.get_crew_dashboard_jobs(p_company_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  job_id uuid,
  subcontractor_user_id uuid,
  scheduled_date date,
  arrival_window_start time,
  arrival_window_end time,
  status text,
  status_updated_at timestamptz,
  is_locked boolean,
  lock_reason text,
  scope_summary text,
  special_instructions text,
  created_at timestamptz,
  docs_valid boolean,
  photo_uploaded_total bigint,
  photo_required_total bigint,
  photo_required_buckets bigint,
  checklist_required_items bigint,
  checklist_checked_items bigint,
  photos_complete boolean,
  checklist_complete boolean,
  can_complete boolean,
  blocked_reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT 
    v.id,
    v.company_id,
    v.job_id,
    v.subcontractor_user_id,
    v.scheduled_date,
    v.arrival_window_start,
    v.arrival_window_end,
    v.status,
    v.status_updated_at,
    v.is_locked,
    v.lock_reason,
    v.scope_summary,
    v.special_instructions,
    v.created_at,
    v.docs_valid,
    v.photo_uploaded_total,
    v.photo_required_total,
    v.photo_required_buckets,
    v.checklist_required_items,
    v.checklist_checked_items,
    v.photos_complete,
    v.checklist_complete,
    v.can_complete,
    v.blocked_reason
  FROM crew.v_dashboard_jobs v
  WHERE v.subcontractor_user_id = auth.uid()
    AND (p_company_id IS NULL OR v.company_id = p_company_id)
  ORDER BY v.scheduled_date NULLS LAST, v.arrival_window_start NULLS LAST
$$;

-- Get crew company user for specific company
CREATE OR REPLACE FUNCTION public.get_crew_company_user_for_company(p_user_id uuid, p_company_id uuid)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  user_id uuid,
  role text,
  is_active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT 
    cu.id,
    cu.company_id,
    cu.user_id,
    cu.role::text,
    cu.is_active
  FROM crew.company_users cu
  WHERE cu.user_id = p_user_id
    AND cu.company_id = p_company_id
    AND cu.is_active = true
  LIMIT 1
$$;

-- Get subcontractor profile for specific company
CREATE OR REPLACE FUNCTION public.get_crew_subcontractor_profile_for_company(p_user_id uuid, p_company_id uuid)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  user_id uuid,
  legal_business_name text,
  dba text,
  primary_contact_name text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  emergency_contact_name text,
  emergency_contact_relationship text,
  emergency_contact_phone text,
  emergency_contact_alt_phone text,
  primary_trade text,
  trade_tags text[]
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT 
    sp.id,
    sp.company_id,
    sp.user_id,
    sp.legal_business_name,
    sp.dba,
    sp.primary_contact_name,
    sp.phone,
    sp.email,
    sp.address_line1,
    sp.address_line2,
    sp.city,
    sp.state,
    sp.postal_code,
    sp.emergency_contact_name,
    sp.emergency_contact_relationship,
    sp.emergency_contact_phone,
    sp.emergency_contact_alt_phone,
    sp.primary_trade::text,
    sp.trade_tags
  FROM crew.subcontractor_profiles sp
  WHERE sp.user_id = p_user_id
    AND sp.company_id = p_company_id
  LIMIT 1
$$;