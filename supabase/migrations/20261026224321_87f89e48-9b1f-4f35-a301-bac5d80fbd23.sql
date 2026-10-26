CREATE OR REPLACE FUNCTION public.confirm_demo_slot_by_token(_token text,_slot timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.demo_requests%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.demo_requests WHERE booking_token=_token FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid booking token'; END IF;
 IF d.confirmed_slot IS NOT NULL THEN
  IF d.confirmed_slot=_slot THEN RETURN d.id; END IF;
  RAISE EXCEPTION 'This meeting is already booked';
 END IF;
 IF d.assigned_to IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=d.assigned_to AND p.tenant_id IS NOT NULL) THEN
  RAISE EXCEPTION 'The booking host is unavailable. Please contact your demo host.';
 END IF;
 IF d.appointment_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.appointments a WHERE a.id=d.appointment_id AND a.assigned_to IS DISTINCT FROM d.assigned_to) THEN
  RAISE EXCEPTION 'The booking host has changed. Please contact your demo host.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(d.assigned_to::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.get_demo_available_slots(_token) WHERE slot=_slot) THEN RAISE EXCEPTION 'This time is not available. Please choose another offered time.'; END IF;
 RETURN public.confirm_demo_slot_internal(_token,_slot);
END; $$;
REVOKE ALL ON FUNCTION public.confirm_demo_slot_by_token(text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_demo_slot_by_token(text,timestamptz) TO service_role;