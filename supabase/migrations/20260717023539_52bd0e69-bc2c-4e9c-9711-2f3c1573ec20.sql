
-- 1) Repair booking-token trigger: gen_random_bytes lives in the extensions schema.
CREATE OR REPLACE FUNCTION public.set_demo_booking_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.booking_token IS NULL THEN
    NEW.booking_token := encode(extensions.gen_random_bytes(24), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

-- 2) Safe public submit RPC: inserts a demo_request and returns only the new id.
CREATE OR REPLACE FUNCTION public.submit_demo_request(
  p_first_name  TEXT,
  p_last_name   TEXT,
  p_email       TEXT,
  p_company     TEXT,
  p_phone       TEXT DEFAULT NULL,
  p_job_title   TEXT DEFAULT NULL,
  p_message     TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email required';
  END IF;

  INSERT INTO public.demo_requests (
    first_name, last_name, email, phone, company_name, job_title, message,
    email_sent, interview_status
  ) VALUES (
    p_first_name, p_last_name, lower(trim(p_email)), p_phone, p_company, p_job_title, p_message,
    false, 'pending'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_demo_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_demo_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;
