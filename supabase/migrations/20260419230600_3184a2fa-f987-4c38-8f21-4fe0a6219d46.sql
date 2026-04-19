
-- Add booking token column
ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS booking_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS booking_token_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booking_confirmed_at TIMESTAMPTZ;

-- Backfill tokens for existing rows
UPDATE public.demo_requests
SET booking_token = encode(gen_random_bytes(24), 'hex')
WHERE booking_token IS NULL;

-- Default for new rows
CREATE OR REPLACE FUNCTION public.set_demo_booking_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.booking_token IS NULL THEN
    NEW.booking_token := encode(gen_random_bytes(24), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demo_booking_token ON public.demo_requests;
CREATE TRIGGER trg_demo_booking_token
BEFORE INSERT ON public.demo_requests
FOR EACH ROW EXECUTE FUNCTION public.set_demo_booking_token();

CREATE INDEX IF NOT EXISTS idx_demo_requests_booking_token ON public.demo_requests(booking_token);

-- Public read via token (used by /book-demo/:token page through a security-definer RPC, but keep a narrow policy for direct reads)
-- We use a SECURITY DEFINER RPC instead of a permissive policy to avoid leaking PII via the token.

CREATE OR REPLACE FUNCTION public.get_demo_request_by_token(_token TEXT)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  company_name TEXT,
  confirmed_slot TIMESTAMPTZ,
  booking_confirmed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, first_name, last_name, email, company_name, confirmed_slot, booking_confirmed_at
  FROM public.demo_requests
  WHERE booking_token = _token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_demo_request_by_token(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirm_demo_slot_by_token(_token TEXT, _slot TIMESTAMPTZ)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
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
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Invalid booking token';
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_demo_slot_by_token(TEXT, TIMESTAMPTZ) TO anon, authenticated;
