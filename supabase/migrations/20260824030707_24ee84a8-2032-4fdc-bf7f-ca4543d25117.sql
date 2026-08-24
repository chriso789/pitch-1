CREATE OR REPLACE FUNCTION public.create_demo_appointment_for_request(_demo_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_demo public.demo_requests%ROWTYPE;
  v_tenant UUID;
  v_assigned UUID;
  v_slot TIMESTAMPTZ;
  v_appt UUID;
  v_title TEXT;
  v_notes TEXT;
BEGIN
  SELECT * INTO v_demo FROM public.demo_requests WHERE id = _demo_id;
  IF v_demo.id IS NULL THEN RETURN NULL; END IF;

  v_slot := COALESCE(v_demo.confirmed_slot, v_demo.preferred_slot_1);
  IF v_slot IS NULL THEN RETURN NULL; END IF;

  v_assigned := v_demo.assigned_to;
  IF v_assigned IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_assigned;
  END IF;
  IF v_tenant IS NULL THEN
    SELECT p.tenant_id, p.id INTO v_tenant, v_assigned
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'master'
    WHERE p.tenant_id IS NOT NULL
    ORDER BY p.created_at
    LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;

  v_title := 'Demo: ' || COALESCE(NULLIF(v_demo.company_name, ''), trim(coalesce(v_demo.first_name,'') || ' ' || coalesce(v_demo.last_name,'')));
  v_notes := 'PITCH CRM video demo' ||
             E'\nContact: ' || trim(coalesce(v_demo.first_name,'') || ' ' || coalesce(v_demo.last_name,'')) ||
             E'\nEmail: ' || coalesce(v_demo.email, '-') ||
             E'\nPhone: ' || coalesce(v_demo.phone, '-') ||
             CASE WHEN v_demo.meeting_link IS NOT NULL THEN E'\nMeeting link: ' || v_demo.meeting_link ELSE '' END;

  IF v_demo.appointment_id IS NOT NULL THEN
    UPDATE public.appointments
    SET scheduled_start = v_slot,
        scheduled_end = v_slot + interval '30 minutes',
        title = v_title,
        notes = v_notes,
        status = 'scheduled',
        updated_at = now()
    WHERE id = v_demo.appointment_id
    RETURNING id INTO v_appt;
  END IF;

  IF v_appt IS NULL THEN
    INSERT INTO public.appointments (
      tenant_id, assigned_to, created_by, title, appointment_type,
      scheduled_start, scheduled_end, status, notes
    ) VALUES (
      v_tenant, v_assigned, v_assigned, v_title, 'other',
      v_slot, v_slot + interval '30 minutes', 'scheduled', v_notes
    )
    RETURNING id INTO v_appt;

    UPDATE public.demo_requests SET appointment_id = v_appt WHERE id = v_demo.id;
  END IF;

  RETURN v_appt;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_demo_request_calendar_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.confirmed_slot, NEW.preferred_slot_1) IS NOT NULL THEN
    PERFORM public.create_demo_appointment_for_request(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS demo_request_calendar_sync ON public.demo_requests;
CREATE TRIGGER demo_request_calendar_sync
AFTER INSERT ON public.demo_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_demo_request_calendar_sync();

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.demo_requests
    WHERE appointment_id IS NULL
      AND COALESCE(confirmed_slot, preferred_slot_1) IS NOT NULL
      AND COALESCE(confirmed_slot, preferred_slot_1) > now()
  LOOP
    PERFORM public.create_demo_appointment_for_request(r.id);
  END LOOP;
END $$;