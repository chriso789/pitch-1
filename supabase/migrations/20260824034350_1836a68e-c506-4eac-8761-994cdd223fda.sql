ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS google_event_id TEXT,
  ADD COLUMN IF NOT EXISTS google_event_link TEXT,
  ADD COLUMN IF NOT EXISTS calendar_synced_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.tg_demo_request_auto_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.confirmed_slot IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.confirmed_slot IS DISTINCT FROM OLD.confirmed_slot) THEN
    NEW.interview_status := 'scheduled';
    IF COALESCE(NEW.status, 'new') NOT IN ('completed', 'converted', 'declined') THEN
      NEW.status := 'scheduled';
    END IF;
    IF NEW.booking_confirmed_at IS NULL THEN
      NEW.booking_confirmed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS demo_request_auto_schedule ON public.demo_requests;
CREATE TRIGGER demo_request_auto_schedule
BEFORE INSERT OR UPDATE ON public.demo_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_demo_request_auto_schedule();

REVOKE EXECUTE ON FUNCTION public.tg_demo_request_auto_schedule() FROM anon, authenticated;