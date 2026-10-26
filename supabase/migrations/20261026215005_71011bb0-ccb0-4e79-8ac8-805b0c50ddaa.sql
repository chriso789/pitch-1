ALTER TABLE public.demo_requests ADD COLUMN IF NOT EXISTS booking_available_slots timestamptz[];
CREATE OR REPLACE FUNCTION public.set_demo_booking_availability(_demo_id uuid, _slots timestamptz[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='master') THEN RAISE EXCEPTION 'Platform administrator access required'; END IF;
 IF coalesce(cardinality(_slots),0) NOT BETWEEN 1 AND 500 OR EXISTS(SELECT 1 FROM unnest(_slots) s WHERE s IS NULL OR s<=now()) THEN RAISE EXCEPTION 'Choose future meeting times'; END IF;
 UPDATE public.demo_requests SET booking_available_slots=ARRAY(SELECT DISTINCT s FROM unnest(_slots) s ORDER BY s),assigned_to=auth.uid() WHERE id=_demo_id AND confirmed_slot IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable or already booked'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_demo_booking_availability(uuid,timestamptz[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_demo_booking_availability(uuid,timestamptz[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_demo_available_slots(_token text) RETURNS TABLE(slot timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT s FROM public.demo_requests d CROSS JOIN LATERAL unnest(d.booking_available_slots) s
 WHERE d.booking_token=_token AND d.confirmed_slot IS NULL AND s>now()
 AND NOT EXISTS(SELECT 1 FROM public.appointments a WHERE a.assigned_to=d.assigned_to AND a.status NOT IN ('cancelled','canceled') AND a.scheduled_start<s+interval '30 minutes' AND a.scheduled_end>s)
 AND NOT EXISTS(SELECT 1 FROM public.demo_requests other WHERE other.id<>d.id AND other.assigned_to=d.assigned_to AND other.confirmed_slot<s+interval '30 minutes' AND other.confirmed_slot+interval '30 minutes'>s)
 ORDER BY s;
$$;
REVOKE ALL ON FUNCTION public.get_demo_available_slots(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_demo_available_slots(text) TO anon,authenticated;
ALTER FUNCTION public.confirm_demo_slot_by_token(text,timestamptz) RENAME TO confirm_demo_slot_internal;
REVOKE ALL ON FUNCTION public.confirm_demo_slot_internal(text,timestamptz) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.confirm_demo_slot_by_token(_token text,_slot timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.demo_requests%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.demo_requests WHERE booking_token=_token FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Invalid booking token'; END IF;
 IF d.confirmed_slot IS NOT NULL THEN
  IF d.confirmed_slot=_slot THEN RETURN d.id; END IF;
  RAISE EXCEPTION 'This meeting is already booked';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(d.assigned_to::text,'demo-booking'),0));
 IF NOT EXISTS(SELECT 1 FROM public.get_demo_available_slots(_token) WHERE slot=_slot) THEN RAISE EXCEPTION 'This time is not available. Please choose another offered time.'; END IF;
 RETURN public.confirm_demo_slot_internal(_token,_slot);
END; $$;
REVOKE ALL ON FUNCTION public.confirm_demo_slot_by_token(text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_demo_slot_by_token(text,timestamptz) TO anon,authenticated;