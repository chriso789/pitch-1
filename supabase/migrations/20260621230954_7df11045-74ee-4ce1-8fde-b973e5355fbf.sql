
-- ============================================================
-- PIPELINE HARDENING: Manager Approval Gate + C-L-J Integrity
-- ============================================================

-- ---------- 1. Role helpers ----------
CREATE OR REPLACE FUNCTION public.is_pipeline_override_role(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role IN ('master','owner')
  );
$$;

CREATE OR REPLACE FUNCTION public.has_active_lead_approval(p_pipeline_entry_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.manager_approval_queue
    WHERE pipeline_entry_id = p_pipeline_entry_id AND status = 'approved'
  );
$$;

-- ---------- 2. Replace approval gate with HARD enforcement ----------
CREATE OR REPLACE FUNCTION public.enforce_manager_approval_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_override boolean := false;
  v_has_approval boolean := false;
BEGIN
  IF NEW.status = 'project' AND (OLD.status IS DISTINCT FROM 'project') THEN
    IF v_uid IS NULL THEN
      RETURN NEW; -- trusted service-role / edge function path
    END IF;

    v_is_override := public.is_pipeline_override_role(v_uid);
    v_has_approval := public.has_active_lead_approval(NEW.id);

    IF NOT v_is_override AND NOT v_has_approval THEN
      INSERT INTO public.manager_approval_history (
        approval_queue_id, tenant_id, performed_by, action,
        previous_status, new_status, notes
      )
      SELECT q.id, NEW.tenant_id, v_uid, 'blocked_no_approval',
             OLD.status, 'project',
             'Direct lead->project transition blocked: no approved manager_approval_queue row'
      FROM public.manager_approval_queue q
      WHERE q.pipeline_entry_id = NEW.id
      ORDER BY q.created_at DESC LIMIT 1;

      RAISE EXCEPTION 'lead_to_project_requires_approval'
        USING HINT = 'Submit a manager approval and have it approved before converting this lead.',
              ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.manager_approval_history (
      approval_queue_id, tenant_id, performed_by, action,
      previous_status, new_status, notes
    )
    SELECT q.id, NEW.tenant_id, v_uid,
           CASE WHEN v_is_override THEN 'override_conversion' ELSE 'gated_conversion' END,
           OLD.status, 'project',
           CASE WHEN v_is_override THEN 'Master/owner override' ELSE 'Approved gated conversion' END
    FROM public.manager_approval_queue q
    WHERE q.pipeline_entry_id = NEW.id
    ORDER BY q.created_at DESC LIMIT 1;

    IF v_is_override AND NOT v_has_approval THEN
      INSERT INTO public.manager_approval_history (
        approval_queue_id, tenant_id, performed_by, action, previous_status, new_status, notes
      ) VALUES (
        NULL, NEW.tenant_id, v_uid, 'override_conversion',
        OLD.status, 'project', 'Master/owner direct conversion (no approval row)'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------- 3. projects INSERT gate ----------
CREATE OR REPLACE FUNCTION public.enforce_project_insert_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NEW.pipeline_entry_id IS NULL OR v_uid IS NULL THEN RETURN NEW; END IF;
  IF public.is_pipeline_override_role(v_uid) THEN RETURN NEW; END IF;
  IF NOT public.has_active_lead_approval(NEW.pipeline_entry_id) THEN
    RAISE EXCEPTION 'project_insert_requires_lead_approval'
      USING HINT = 'projects.pipeline_entry_id requires an approved manager_approval_queue row',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_project_insert_approval ON public.projects;
CREATE TRIGGER trg_enforce_project_insert_approval
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_insert_approval();

-- ---------- 4. Dedupe existing C-L-J numbers (keep oldest row) ----------
-- contacts
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id, clj_formatted_number ORDER BY created_at, id) rn
  FROM public.contacts
  WHERE clj_formatted_number IS NOT NULL AND COALESCE(is_deleted,false) = false
)
UPDATE public.contacts c
SET clj_formatted_number = public.generate_clj_number()
FROM ranked
WHERE c.id = ranked.id AND ranked.rn > 1;

-- pipeline_entries
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id, clj_formatted_number ORDER BY created_at, id) rn
  FROM public.pipeline_entries
  WHERE clj_formatted_number IS NOT NULL
)
UPDATE public.pipeline_entries pe
SET clj_formatted_number = public.generate_clj_number()
FROM ranked
WHERE pe.id = ranked.id AND ranked.rn > 1;

-- ---------- 5. UNIQUE per-tenant partial indexes ----------
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contacts_tenant_clj
  ON public.contacts (tenant_id, clj_formatted_number)
  WHERE clj_formatted_number IS NOT NULL AND is_deleted IS NOT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pipeline_entries_tenant_clj
  ON public.pipeline_entries (tenant_id, clj_formatted_number)
  WHERE clj_formatted_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_projects_tenant_clj
  ON public.projects (tenant_id, clj_formatted_number)
  WHERE clj_formatted_number IS NOT NULL;

-- ---------- 6. Immutability triggers ----------
CREATE OR REPLACE FUNCTION public.enforce_clj_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF OLD.clj_formatted_number IS NOT NULL
     AND NEW.clj_formatted_number IS DISTINCT FROM OLD.clj_formatted_number THEN
    IF v_uid IS NOT NULL AND NOT public.is_pipeline_override_role(v_uid) THEN
      RAISE EXCEPTION 'clj_formatted_number is immutable (old=%, new=%)',
        OLD.clj_formatted_number, NEW.clj_formatted_number
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clj_immutable_contacts ON public.contacts;
CREATE TRIGGER trg_clj_immutable_contacts BEFORE UPDATE OF clj_formatted_number ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_clj_immutability();

DROP TRIGGER IF EXISTS trg_clj_immutable_pipeline_entries ON public.pipeline_entries;
CREATE TRIGGER trg_clj_immutable_pipeline_entries BEFORE UPDATE OF clj_formatted_number ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_clj_immutability();

DROP TRIGGER IF EXISTS trg_clj_immutable_projects ON public.projects;
CREATE TRIGGER trg_clj_immutable_projects BEFORE UPDATE OF clj_formatted_number ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_clj_immutability();

-- ---------- 7. Approval-queue audit completeness ----------
CREATE OR REPLACE FUNCTION public.audit_manager_approval_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.manager_approval_history (
      approval_queue_id, tenant_id, performed_by, action,
      previous_status, new_status, notes
    ) VALUES (
      NEW.id, NEW.tenant_id, COALESCE(auth.uid(), NEW.reviewed_by, NEW.requested_by),
      'status_change_' || NEW.status,
      OLD.status, NEW.status, NEW.manager_notes
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_manager_approval_status ON public.manager_approval_queue;
CREATE TRIGGER trg_audit_manager_approval_status
  AFTER UPDATE OF status ON public.manager_approval_queue
  FOR EACH ROW EXECUTE FUNCTION public.audit_manager_approval_status_change();

-- ---------- 8. Idempotent backfill ----------
CREATE OR REPLACE FUNCTION public.backfill_clj_numbers(p_tenant_id uuid)
RETURNS TABLE(contacts_updated int, pipeline_updated int, projects_updated int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c int := 0; v_p int := 0; v_j int := 0; r record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('clj_backfill:' || p_tenant_id::text));

  FOR r IN SELECT id FROM public.contacts
    WHERE tenant_id = p_tenant_id AND clj_formatted_number IS NULL
      AND COALESCE(is_deleted,false) = false ORDER BY created_at
  LOOP
    UPDATE public.contacts SET clj_formatted_number = public.generate_clj_number() WHERE id = r.id;
    v_c := v_c + 1;
  END LOOP;

  FOR r IN SELECT id FROM public.pipeline_entries
    WHERE tenant_id = p_tenant_id AND clj_formatted_number IS NULL ORDER BY created_at
  LOOP
    UPDATE public.pipeline_entries SET clj_formatted_number = public.generate_clj_number() WHERE id = r.id;
    v_p := v_p + 1;
  END LOOP;

  FOR r IN SELECT id FROM public.projects
    WHERE tenant_id = p_tenant_id AND clj_formatted_number IS NULL ORDER BY created_at
  LOOP
    UPDATE public.projects SET clj_formatted_number = public.generate_clj_number() WHERE id = r.id;
    v_j := v_j + 1;
  END LOOP;

  RETURN QUERY SELECT v_c, v_p, v_j;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_clj_numbers(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_lead_approval(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_pipeline_override_role(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
