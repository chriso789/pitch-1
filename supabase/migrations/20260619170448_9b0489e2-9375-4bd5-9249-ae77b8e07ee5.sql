
-- Ensure we can find appointments tied to a labor order
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS source_assignment_id UUID REFERENCES public.production_order_assignments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS appointments_source_assignment_idx ON public.appointments(source_assignment_id);

CREATE OR REPLACE FUNCTION public.trg_labor_order_sync_calendar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_rep UUID;
  v_pe UUID;
  v_title TEXT;
  v_address TEXT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_existing UUID;
BEGIN
  IF NEW.order_type <> 'labor' THEN RETURN NEW; END IF;

  -- delete calendar event if no longer scheduled
  IF NEW.status <> 'scheduled' OR NEW.scheduled_date IS NULL THEN
    DELETE FROM public.appointments WHERE source_assignment_id = NEW.id;
    RETURN NEW;
  END IF;

  -- resolve sales rep via pipeline_entry on the project
  SELECT pipeline_entry_id INTO v_pe FROM public.projects WHERE id = NEW.project_id;
  IF v_pe IS NOT NULL THEN
    SELECT assigned_to,
           NULLIF(concat_ws(', ',
             NULLIF(address_street,''),
             NULLIF(address_city,''),
             NULLIF(address_state,''),
             NULLIF(address_zip,'')
           ), '')
      INTO v_rep, v_address
      FROM public.pipeline_entries WHERE id = v_pe;
  END IF;

  v_title := COALESCE('Labor: ' || NEW.title, 'Labor Order');
  v_start := (NEW.scheduled_date::timestamp + time '08:00') AT TIME ZONE 'UTC';
  v_end   := (NEW.scheduled_date::timestamp + time '17:00') AT TIME ZONE 'UTC';

  SELECT id INTO v_existing FROM public.appointments WHERE source_assignment_id = NEW.id LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.appointments(
      tenant_id, assigned_to, title, appointment_type, scheduled_start, scheduled_end,
      status, address, notes, source_assignment_id, created_by
    ) VALUES (
      NEW.tenant_id, v_rep, v_title, 'labor_order', v_start, v_end,
      'scheduled', v_address, NEW.notes, NEW.id, NEW.assigned_by
    );
  ELSE
    UPDATE public.appointments
       SET assigned_to = COALESCE(v_rep, assigned_to),
           title = v_title,
           scheduled_start = v_start,
           scheduled_end = v_end,
           address = v_address,
           notes = NEW.notes,
           updated_at = now()
     WHERE id = v_existing;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS labor_order_sync_calendar ON public.production_order_assignments;
CREATE TRIGGER labor_order_sync_calendar
AFTER INSERT OR UPDATE OF status, scheduled_date, project_id, crew_id, title, notes
ON public.production_order_assignments
FOR EACH ROW EXECUTE FUNCTION public.trg_labor_order_sync_calendar();

NOTIFY pgrst, 'reload schema';
