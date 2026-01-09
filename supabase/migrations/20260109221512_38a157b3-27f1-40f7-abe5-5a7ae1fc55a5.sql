-- ============================================================
-- STORAGE BUCKETS + RLS POLICIES + SEED FUNCTION + DASHBOARD VIEW
-- ============================================================

-- ------------------------------------------------------------
-- Helper: parse UUID segments from storage object "name"
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION crew.storage_company_id_from_name(_name text)
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE 
    WHEN split_part(_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN split_part(_name, '/', 2)::uuid
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION crew.storage_sub_user_id_from_name(_name text)
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE 
    WHEN split_part(_name, '/', 4) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN split_part(_name, '/', 4)::uuid
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION crew.storage_job_id_from_name(_name text)
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE 
    WHEN split_part(_name, '/', 4) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN split_part(_name, '/', 4)::uuid
    ELSE NULL
  END
$$;

-- ------------------------------------------------------------
-- CREATE STORAGE BUCKETS
-- ------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('crew-docs', 'crew-docs', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('crew-photos', 'crew-photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------
-- BUCKET: crew-docs RLS POLICIES
-- Path: company/<company_id>/subs/<sub_user_id>/docs/<document_id>/<filename>
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "crew_docs_select" ON storage.objects;
CREATE POLICY "crew_docs_select" ON storage.objects FOR SELECT
USING (
  bucket_id = 'crew-docs'
  AND (
    crew.is_admin(crew.storage_company_id_from_name(name))
    OR crew.storage_sub_user_id_from_name(name) = auth.uid()
  )
);

DROP POLICY IF EXISTS "crew_docs_insert" ON storage.objects;
CREATE POLICY "crew_docs_insert" ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'crew-docs'
  AND (
    crew.is_admin(crew.storage_company_id_from_name(name))
    OR crew.storage_sub_user_id_from_name(name) = auth.uid()
  )
);

DROP POLICY IF EXISTS "crew_docs_update" ON storage.objects;
CREATE POLICY "crew_docs_update" ON storage.objects FOR UPDATE
USING (
  bucket_id = 'crew-docs'
  AND (
    crew.is_admin(crew.storage_company_id_from_name(name))
    OR crew.storage_sub_user_id_from_name(name) = auth.uid()
  )
);

DROP POLICY IF EXISTS "crew_docs_delete" ON storage.objects;
CREATE POLICY "crew_docs_delete" ON storage.objects FOR DELETE
USING (
  bucket_id = 'crew-docs'
  AND (
    crew.is_admin(crew.storage_company_id_from_name(name))
    OR crew.storage_sub_user_id_from_name(name) = auth.uid()
  )
);

-- ------------------------------------------------------------
-- BUCKET: crew-photos RLS POLICIES
-- Path: company/<company_id>/jobs/<job_id>/subs/<sub_user_id>/photos/<photo_id>/<filename>
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "crew_photos_select" ON storage.objects;
CREATE POLICY "crew_photos_select" ON storage.objects FOR SELECT
USING (
  bucket_id = 'crew-photos'
  AND (
    crew.is_admin(crew.storage_company_id_from_name(name))
    OR (
      crew.storage_sub_user_id_from_name(name) = auth.uid()
      AND crew.is_assigned_to_job(
        crew.storage_company_id_from_name(name),
        crew.storage_job_id_from_name(name)
      )
    )
  )
);

DROP POLICY IF EXISTS "crew_photos_insert" ON storage.objects;
CREATE POLICY "crew_photos_insert" ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'crew-photos'
  AND (
    crew.is_admin(crew.storage_company_id_from_name(name))
    OR (
      crew.storage_sub_user_id_from_name(name) = auth.uid()
      AND crew.is_assigned_to_job(
        crew.storage_company_id_from_name(name),
        crew.storage_job_id_from_name(name)
      )
    )
  )
);

DROP POLICY IF EXISTS "crew_photos_update" ON storage.objects;
CREATE POLICY "crew_photos_update" ON storage.objects FOR UPDATE
USING (
  bucket_id = 'crew-photos'
  AND (
    crew.is_admin(crew.storage_company_id_from_name(name))
    OR (
      crew.storage_sub_user_id_from_name(name) = auth.uid()
      AND crew.is_assigned_to_job(
        crew.storage_company_id_from_name(name),
        crew.storage_job_id_from_name(name)
      )
    )
  )
);

DROP POLICY IF EXISTS "crew_photos_delete" ON storage.objects;
CREATE POLICY "crew_photos_delete" ON storage.objects FOR DELETE
USING (
  bucket_id = 'crew-photos'
  AND (
    crew.is_admin(crew.storage_company_id_from_name(name))
    OR (
      crew.storage_sub_user_id_from_name(name) = auth.uid()
      AND crew.is_assigned_to_job(
        crew.storage_company_id_from_name(name),
        crew.storage_job_id_from_name(name)
      )
    )
  )
);

-- ============================================================
-- SEED FUNCTION: Standard Roofing Photo Buckets + Checklist
-- ============================================================

CREATE OR REPLACE FUNCTION crew.seed_roofing_defaults(_company_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  tmpl_id uuid;
BEGIN
  -- PHOTO BUCKETS (Standard Roof)
  INSERT INTO crew.photo_buckets(company_id, key, label, description)
  VALUES
    (_company_id, 'ARRIVAL', 'Arrival Photo', 'Crew on-site arrival / house front'),
    (_company_id, 'PRE_WORK', 'Pre-Work Overview', 'Before any work begins: all elevations'),
    (_company_id, 'PROTECTION', 'Protection / Prep', 'Landscaping/tarp/protection setup'),
    (_company_id, 'TEAR_OFF', 'Tear-Off', 'Active tear-off + debris control'),
    (_company_id, 'DECKING', 'Decking', 'Deck exposed; damaged decking documented'),
    (_company_id, 'DRY_IN', 'Dry-In', 'Underlayment / dry-in complete'),
    (_company_id, 'FLASHING', 'Flashing Details', 'Valley/step/flashing close-ups'),
    (_company_id, 'INSTALL_PROGRESS', 'Install Progress', 'In-progress install shots'),
    (_company_id, 'FINAL_ROOF', 'Final Completed Roof', 'Finished roof: multiple angles'),
    (_company_id, 'CLEANUP', 'Cleanup / Ground', 'Magnet sweep + ground cleanup')
  ON CONFLICT (company_id, key) DO NOTHING;

  -- CHECKLIST TEMPLATE (Standard)
  INSERT INTO crew.checklist_templates(company_id, key, label)
  VALUES (_company_id, 'ROOF_STANDARD', 'Roofing - Standard Job Checklist')
  ON CONFLICT (company_id, key) DO UPDATE SET label = EXCLUDED.label
  RETURNING id INTO tmpl_id;

  IF tmpl_id IS NULL THEN
    SELECT id INTO tmpl_id
    FROM crew.checklist_templates
    WHERE company_id = _company_id AND key = 'ROOF_STANDARD'
    LIMIT 1;
  END IF;

  -- CHECKLIST ITEMS
  INSERT INTO crew.checklist_items(template_id, sort_order, label, help_text, requires_photo, is_required)
  VALUES
    (tmpl_id, 10, 'Materials delivered or confirmed on-site', 'Confirm materials are present before start', false, true),
    (tmpl_id, 20, 'Property protected (landscaping/windows/pool)', 'Tarps/plywood as needed', true, true),
    (tmpl_id, 30, 'Permit posted (if required)', 'Photo of permit in window or posted location', true, false),
    (tmpl_id, 40, 'Tear-off completed and debris controlled', 'No loose debris; driveway protected', true, true),
    (tmpl_id, 50, 'Decking condition verified', 'Document rot/damage; notify PM', true, true),
    (tmpl_id, 60, 'Underlayment / dry-in installed per scope', 'Correct product, correct coverage', true, true),
    (tmpl_id, 70, 'Flashing/valley details installed correctly', 'Close-ups required', true, true),
    (tmpl_id, 80, 'Ventilation installed per scope', 'Intake/exhaust matches scope', true, true),
    (tmpl_id, 90, 'Roof system installed per manufacturer requirements', 'Nailing pattern / alignment / seal', false, true),
    (tmpl_id, 100, 'Final walk completed and punch list addressed', 'All issues resolved', false, true),
    (tmpl_id, 110, 'Cleanup completed (magnet sweep, nails, debris)', 'Photo of clean ground + magnet sweep', true, true),
    (tmpl_id, 120, 'Final photos uploaded to all required buckets', 'Completion requires photo compliance anyway', false, true)
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- DASHBOARD VIEW: One-query mobile dashboard
-- ============================================================

CREATE OR REPLACE VIEW crew.v_dashboard_jobs AS
SELECT
  ja.id,
  ja.company_id,
  ja.job_id,
  ja.subcontractor_user_id,
  ja.scheduled_date,
  ja.arrival_window_start,
  ja.arrival_window_end,
  ja.status,
  ja.status_updated_at,
  ja.is_locked,
  ja.lock_reason,
  ja.scope_summary,
  ja.special_instructions,
  ja.created_at,

  -- Docs gate
  crew.sub_docs_valid(ja.company_id, ja.subcontractor_user_id) AS docs_valid,

  -- Photo progress (simplified - counts from job_photos)
  COALESCE(photo_counts.uploaded_total, 0) AS photo_uploaded_total,
  COALESCE(req_counts.required_total, 0) AS photo_required_total,
  COALESCE(req_counts.required_buckets, 0) AS photo_required_buckets,

  -- Checklist progress (simplified)
  COALESCE(checklist_counts.required_items, 0) AS checklist_required_items,
  COALESCE(checklist_counts.checked_items, 0) AS checklist_checked_items,

  -- Gate functions
  crew.photo_requirements_met(ja.company_id, ja.job_id, ja.subcontractor_user_id) AS photos_complete,
  crew.checklist_met(ja.company_id, ja.job_id, ja.subcontractor_user_id) AS checklist_complete,
  crew.can_complete_job(ja.company_id, ja.job_id, ja.subcontractor_user_id) AS can_complete,

  -- Block reason
  CASE
    WHEN NOT crew.sub_docs_valid(ja.company_id, ja.subcontractor_user_id) THEN 'Missing/expired required documents'
    WHEN NOT crew.photo_requirements_met(ja.company_id, ja.job_id, ja.subcontractor_user_id) THEN 'Missing required photos'
    WHEN NOT crew.checklist_met(ja.company_id, ja.job_id, ja.subcontractor_user_id) THEN 'Checklist incomplete'
    ELSE NULL
  END AS blocked_reason

FROM crew.job_assignments ja

LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS uploaded_total
  FROM crew.job_photos p
  WHERE p.company_id = ja.company_id
    AND p.job_id = ja.job_id
    AND p.subcontractor_user_id = ja.subcontractor_user_id
) photo_counts ON true

LEFT JOIN LATERAL (
  SELECT 
    COUNT(*)::int AS required_buckets,
    COALESCE(SUM(required_count), 0)::int AS required_total
  FROM crew.job_photo_requirements r
  WHERE r.company_id = ja.company_id
    AND r.job_id = ja.job_id
    AND r.is_required = true
) req_counts ON true

LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS required_items,
    COUNT(*) FILTER (WHERE resp.is_checked = true)::int AS checked_items
  FROM crew.job_checklists jc
  JOIN crew.checklist_items ci ON ci.template_id = jc.template_id AND ci.is_required = true
  LEFT JOIN crew.job_checklist_responses resp 
    ON resp.job_checklist_id = jc.id 
    AND resp.item_id = ci.id
    AND resp.subcontractor_user_id = ja.subcontractor_user_id
  WHERE jc.company_id = ja.company_id AND jc.job_id = ja.job_id
) checklist_counts ON true;

-- ============================================================
-- RPC FUNCTION: Get dashboard jobs for current user
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_crew_dashboard_jobs()
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
  photo_uploaded_total int,
  photo_required_total int,
  photo_required_buckets int,
  checklist_required_items int,
  checklist_checked_items int,
  photos_complete boolean,
  checklist_complete boolean,
  can_complete boolean,
  blocked_reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, crew
AS $$
  SELECT * FROM crew.v_dashboard_jobs
  WHERE subcontractor_user_id = auth.uid()
  ORDER BY scheduled_date NULLS LAST, arrival_window_start NULLS LAST
$$;