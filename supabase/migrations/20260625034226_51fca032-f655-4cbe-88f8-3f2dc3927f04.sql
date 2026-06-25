
CREATE OR REPLACE FUNCTION public.sync_project_start_date_from_crew_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_pipeline_entry_id uuid;
BEGIN
  -- Only act when a crew is actually assigned and we have a date
  IF NEW.crew_id IS NULL OR NEW.assignment_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only act when crew_id transitioned to set OR assignment_date changed
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.crew_id IS NOT DISTINCT FROM NEW.crew_id)
       AND (OLD.assignment_date IS NOT DISTINCT FROM NEW.assignment_date) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.job_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT project_id, pipeline_entry_id
    INTO v_project_id, v_pipeline_entry_id
  FROM public.jobs
  WHERE id = NEW.job_id;

  IF v_project_id IS NOT NULL THEN
    UPDATE public.projects
       SET start_date = NEW.assignment_date,
           updated_at = now()
     WHERE id = v_project_id
       AND (start_date IS NULL OR start_date > NEW.assignment_date);
  ELSIF v_pipeline_entry_id IS NOT NULL THEN
    UPDATE public.projects
       SET start_date = NEW.assignment_date,
           updated_at = now()
     WHERE pipeline_entry_id = v_pipeline_entry_id
       AND (start_date IS NULL OR start_date > NEW.assignment_date);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_project_start_date_from_crew ON public.crew_assignments;
CREATE TRIGGER trg_sync_project_start_date_from_crew
AFTER INSERT OR UPDATE OF crew_id, assignment_date ON public.crew_assignments
FOR EACH ROW
EXECUTE FUNCTION public.sync_project_start_date_from_crew_assignment();

-- Backfill: for existing assignments with a crew, set project.start_date to earliest assignment_date
WITH earliest AS (
  SELECT j.project_id, MIN(ca.assignment_date) AS first_date
  FROM public.crew_assignments ca
  JOIN public.jobs j ON j.id = ca.job_id
  WHERE ca.crew_id IS NOT NULL AND ca.assignment_date IS NOT NULL AND j.project_id IS NOT NULL
  GROUP BY j.project_id
)
UPDATE public.projects p
   SET start_date = e.first_date,
       updated_at = now()
  FROM earliest e
 WHERE p.id = e.project_id
   AND (p.start_date IS NULL OR p.start_date > e.first_date);
