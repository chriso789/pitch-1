
CREATE OR REPLACE FUNCTION public.submit_demo_request_slots(
  p_id UUID,
  p_slot_1 TIMESTAMPTZ,
  p_slot_2 TIMESTAMPTZ,
  p_slot_3 TIMESTAMPTZ,
  p_timezone TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.demo_requests
     SET preferred_slot_1 = p_slot_1,
         preferred_slot_2 = p_slot_2,
         preferred_slot_3 = p_slot_3,
         timezone = p_timezone
   WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_demo_request_slots(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_demo_request_slots(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) TO anon, authenticated;
