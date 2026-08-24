ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS meeting_link TEXT,
  ADD COLUMN IF NOT EXISTS appointment_id UUID;

CREATE OR REPLACE FUNCTION public.confirm_demo_slot_by_token(_token TEXT, _slot TIMESTAMPTZ)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_demo public.demo_requests%ROWTYPE;
  v_tenant UUID;
  v_assigned UUID;
  v_appt UUID;
  v_title TEXT;
  v_notes TEXT;
BEGIN
  IF _slot IS NULL OR _slot < now() THEN
    RAISE EXCEPTION 'Invalid slot';
  END IF;

  UPDATE public.demo_requests
  SET confirmed_slot = _slot,
      booking_confirmed_at = now(),
      interview_status = 'scheduled',
      status = CASE WHEN status IN ('new','contacted') THEN 'scheduled' ELSE status END
  WHERE booking_token = _token
  RETURNING * INTO v_demo;

  IF v_demo.id IS NULL THEN
    RAISE EXCEPTION 'Invalid booking token';
  END IF;

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

  v_title := 'Demo: ' || COALESCE(NULLIF(v_demo.company_name, ''), trim(coalesce(v_demo.first_name,'') || ' ' || coalesce(v_demo.last_name,'')));
  v_notes := 'PITCH CRM video demo' ||
             E'\nContact: ' || trim(coalesce(v_demo.first_name,'') || ' ' || coalesce(v_demo.last_name,'')) ||
             E'\nEmail: ' || coalesce(v_demo.email, '-') ||
             E'\nPhone: ' || coalesce(v_demo.phone, '-') ||
             CASE WHEN v_demo.meeting_link IS NOT NULL THEN E'\nMeeting link: ' || v_demo.meeting_link ELSE '' END;

  IF v_demo.appointment_id IS NOT NULL THEN
    UPDATE public.appointments
    SET scheduled_start = _slot,
        scheduled_end = _slot + interval '30 minutes',
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
      v_tenant, v_assigned, v_assigned, v_title, 'demo',
      _slot, _slot + interval '30 minutes', 'scheduled', v_notes
    )
    RETURNING id INTO v_appt;

    UPDATE public.demo_requests SET appointment_id = v_appt WHERE id = v_demo.id;
  END IF;

  RETURN v_demo.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_demo_slot_by_token(TEXT, TIMESTAMPTZ) TO anon, authenticated;