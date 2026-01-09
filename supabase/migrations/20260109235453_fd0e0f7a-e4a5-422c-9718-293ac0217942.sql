-- ============================================================
-- CREW RPC FUNCTIONS FOR MULTI-TENANT FRONTEND
-- All functions accept p_company_id to support multi-company users
-- ============================================================

-- 1) Get crew job detail (single job with company filter)
CREATE OR REPLACE FUNCTION public.get_crew_job_detail(
  p_job_id uuid,
  p_company_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  job_id uuid,
  subcontractor_user_id uuid,
  scheduled_date date,
  arrival_window_start time,
  arrival_window_end time,
  scope_summary text,
  special_instructions text,
  status text,
  status_updated_at timestamptz,
  is_locked boolean,
  lock_reason text,
  created_at timestamptz,
  photo_uploaded_total int,
  photo_required_total int,
  checklist_checked_items int,
  checklist_required_items int,
  docs_valid boolean,
  photos_complete boolean,
  checklist_complete boolean,
  can_complete boolean,
  blocked_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    v.id,
    v.company_id,
    v.job_id,
    v.subcontractor_user_id,
    v.scheduled_date,
    v.arrival_window_start,
    v.arrival_window_end,
    v.scope_summary,
    v.special_instructions,
    v.status,
    v.status_updated_at,
    v.is_locked,
    v.lock_reason,
    v.created_at,
    v.photo_uploaded_total,
    v.photo_required_total,
    v.checklist_checked_items,
    v.checklist_required_items,
    v.docs_valid,
    v.photos_complete,
    v.checklist_complete,
    v.can_complete,
    v.blocked_reason
  FROM crew.v_dashboard_jobs v
  WHERE v.job_id = p_job_id
    AND v.subcontractor_user_id = auth.uid()
    AND (p_company_id IS NULL OR v.company_id = p_company_id)
  LIMIT 1
$$;

-- 2) Get crew job photos (with company filter)
CREATE OR REPLACE FUNCTION public.get_crew_job_photos(
  p_job_id uuid,
  p_company_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  bucket_id uuid,
  file_url text,
  taken_at timestamptz,
  gps_lat numeric,
  gps_lng numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    jp.id,
    jp.bucket_id,
    jp.file_url,
    jp.taken_at,
    jp.gps_lat,
    jp.gps_lng
  FROM crew.job_photos jp
  JOIN crew.job_assignments ja ON ja.id = jp.job_id  
  WHERE jp.job_id IN (
    SELECT ja2.id FROM crew.job_assignments ja2 
    WHERE ja2.job_id = p_job_id 
      AND ja2.subcontractor_user_id = auth.uid()
      AND (p_company_id IS NULL OR ja2.company_id = p_company_id)
  )
  ORDER BY jp.taken_at DESC
$$;

-- 3) Insert crew job photo (with company_id requirement)
CREATE OR REPLACE FUNCTION public.insert_crew_job_photo(
  p_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_bucket_id uuid,
  p_file_url text,
  p_gps_lat numeric DEFAULT NULL,
  p_gps_lng numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment_id uuid;
BEGIN
  -- Verify user is assigned to this job in this company
  SELECT ja.id INTO v_assignment_id
  FROM crew.job_assignments ja
  WHERE ja.job_id = p_job_id
    AND ja.company_id = p_company_id
    AND ja.subcontractor_user_id = auth.uid();
  
  IF v_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to upload photos for this job';
  END IF;
  
  -- Insert the photo record (use assignment_id as job_id in job_photos)
  INSERT INTO crew.job_photos (
    id,
    company_id,
    job_id,
    bucket_id,
    uploaded_by_user_id,
    file_url,
    gps_lat,
    gps_lng,
    taken_at
  ) VALUES (
    p_id,
    p_company_id,
    v_assignment_id,
    p_bucket_id,
    auth.uid(),
    p_file_url,
    p_gps_lat,
    p_gps_lng,
    now()
  );
  
  RETURN p_id;
END;
$$;

-- 4) Update crew job status (with company_id verification)
CREATE OR REPLACE FUNCTION public.update_crew_job_status(
  p_assignment_id uuid,
  p_new_status text,
  p_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
  v_company_id uuid;
  v_is_locked boolean;
BEGIN
  -- Get current assignment info
  SELECT ja.status, ja.company_id, ja.is_locked
  INTO v_current_status, v_company_id, v_is_locked
  FROM crew.job_assignments ja
  WHERE ja.id = p_assignment_id
    AND ja.subcontractor_user_id = auth.uid()
    AND (p_company_id IS NULL OR ja.company_id = p_company_id);
  
  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Assignment not found or not authorized');
  END IF;
  
  IF v_is_locked THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job is locked and cannot be modified');
  END IF;
  
  -- Update the status
  UPDATE crew.job_assignments
  SET 
    status = p_new_status,
    status_updated_at = now()
  WHERE id = p_assignment_id
    AND subcontractor_user_id = auth.uid();
  
  -- Log the status change
  INSERT INTO crew.job_status_events (
    company_id,
    job_id,
    changed_by_user_id,
    old_status,
    new_status
  ) VALUES (
    v_company_id,
    p_assignment_id,
    auth.uid(),
    v_current_status,
    p_new_status
  );
  
  RETURN jsonb_build_object('success', true, 'new_status', p_new_status);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_crew_job_detail(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crew_job_photos(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_crew_job_photo(uuid, uuid, uuid, uuid, text, numeric, numeric) TO authenticated;