ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS booking_link_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS booking_link_last_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS booking_link_open_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calendar_sync_error text;

-- Service-only: record a booking-link visit. Polling within 30 minutes counts as the same visit.
CREATE OR REPLACE FUNCTION public.record_demo_booking_open(_token text)
RETURNS TABLE(id uuid, first_open boolean, open_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE d public.demo_requests%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.demo_requests WHERE booking_token = _token FOR UPDATE;
  IF d.id IS NULL THEN RETURN; END IF;
  UPDATE public.demo_requests
     SET booking_link_opened_at = coalesce(d.booking_link_opened_at, now()),
         booking_link_last_opened_at = now(),
         booking_link_open_count = CASE
           WHEN d.booking_link_last_opened_at IS NULL OR d.booking_link_last_opened_at < now() - interval '30 minutes'
           THEN d.booking_link_open_count + 1 ELSE d.booking_link_open_count END
   WHERE public.demo_requests.id = d.id;
  RETURN QUERY SELECT d.id, d.booking_link_opened_at IS NULL,
    CASE WHEN d.booking_link_last_opened_at IS NULL OR d.booking_link_last_opened_at < now() - interval '30 minutes'
         THEN d.booking_link_open_count + 1 ELSE d.booking_link_open_count END;
END; $function$;

REVOKE ALL ON FUNCTION public.record_demo_booking_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_demo_booking_open(text) TO service_role;

-- Booking confirmation is server-only (the public page goes through the booking service)
REVOKE ALL ON FUNCTION public.confirm_demo_slot_by_token(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_demo_slot_by_token(text, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.get_demo_available_slots(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_demo_available_slots(text) TO service_role;