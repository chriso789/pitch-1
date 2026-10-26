REVOKE EXECUTE ON FUNCTION public.set_demo_booking_availability(uuid,timestamptz[]) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_demo_available_slots(text) FROM anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_demo_slot_by_token(text,timestamptz) FROM anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_demo_available_slots(text),public.confirm_demo_slot_by_token(text,timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.set_demo_booking_availability(_demo_id uuid,_slots timestamptz[],_host uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_host AND role='master') THEN RAISE EXCEPTION 'Platform administrator access required'; END IF;
 IF coalesce(cardinality(_slots),0) NOT BETWEEN 1 AND 500 OR EXISTS(SELECT 1 FROM unnest(_slots) s WHERE s IS NULL OR s<=now()) THEN RAISE EXCEPTION 'Choose future meeting times'; END IF;
 UPDATE public.demo_requests SET booking_available_slots=ARRAY(SELECT DISTINCT s FROM unnest(_slots) s ORDER BY s),assigned_to=_host WHERE id=_demo_id AND confirmed_slot IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable or already booked'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_demo_booking_availability(uuid,timestamptz[],uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_demo_booking_availability(uuid,timestamptz[],uuid) TO service_role;