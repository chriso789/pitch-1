-- Add database functions for presentation session management

-- Function to start a presentation session
CREATE OR REPLACE FUNCTION public.start_presentation_session(
  p_presentation_id UUID,
  p_contact_id UUID DEFAULT NULL,
  p_access_token TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_tenant_id UUID;
BEGIN
  -- Get tenant_id from presentation
  SELECT tenant_id INTO v_tenant_id
  FROM public.presentations
  WHERE id = p_presentation_id;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Presentation not found';
  END IF;
  
  -- Create session
  INSERT INTO public.presentation_sessions (
    tenant_id,
    presentation_id,
    contact_id,
    status,
    viewer_metadata
  ) VALUES (
    v_tenant_id,
    p_presentation_id,
    p_contact_id,
    'active',
    jsonb_build_object(
      'access_token', p_access_token,
      'started_by', auth.uid(),
      'slides_viewed', '[]'::jsonb,
      'time_per_slide', '{}'::jsonb
    )
  )
  RETURNING id INTO v_session_id;
  
  RETURN v_session_id;
END;
$$;

-- Function to track slide views
CREATE OR REPLACE FUNCTION public.track_slide_view(
  p_session_id UUID,
  p_slide_id UUID,
  p_time_spent INTEGER DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slides_viewed JSONB;
  v_time_per_slide JSONB;
BEGIN
  -- Get current tracking data
  SELECT 
    COALESCE(viewer_metadata->'slides_viewed', '[]'::jsonb),
    COALESCE(viewer_metadata->'time_per_slide', '{}'::jsonb)
  INTO v_slides_viewed, v_time_per_slide
  FROM public.presentation_sessions
  WHERE id = p_session_id;
  
  -- Add slide to viewed array if not already present
  IF NOT (v_slides_viewed @> to_jsonb(p_slide_id::text)) THEN
    v_slides_viewed := v_slides_viewed || to_jsonb(p_slide_id::text);
  END IF;
  
  -- Update time spent on this slide
  v_time_per_slide := jsonb_set(
    v_time_per_slide,
    array[p_slide_id::text],
    to_jsonb(COALESCE((v_time_per_slide->>p_slide_id::text)::integer, 0) + p_time_spent)
  );
  
  -- Update session
  UPDATE public.presentation_sessions
  SET 
    viewer_metadata = jsonb_set(
      jsonb_set(viewer_metadata, '{slides_viewed}', v_slides_viewed),
      '{time_per_slide}', v_time_per_slide
    ),
    updated_at = now()
  WHERE id = p_session_id;
END;
$$;

-- Function to complete presentation session
CREATE OR REPLACE FUNCTION public.complete_presentation_session(
  p_session_id UUID,
  p_signature_data JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.presentation_sessions
  SET 
    status = 'completed',
    completed_at = now(),
    signature_captured = (p_signature_data IS NOT NULL),
    signature_data = p_signature_data,
    updated_at = now()
  WHERE id = p_session_id;
END;
$$;

-- Function to generate shareable presentation link token
CREATE OR REPLACE FUNCTION public.generate_presentation_token(
  p_presentation_id UUID,
  p_contact_id UUID DEFAULT NULL,
  p_expires_in INTERVAL DEFAULT '7 days'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_tenant_id UUID;
BEGIN
  -- Verify presentation exists and get tenant
  SELECT tenant_id INTO v_tenant_id
  FROM public.presentations
  WHERE id = p_presentation_id;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Presentation not found';
  END IF;
  
  -- Generate secure token
  v_token := encode(gen_random_bytes(32), 'base64');
  
  -- Store token metadata in presentation_sessions for validation
  INSERT INTO public.presentation_sessions (
    tenant_id,
    presentation_id,
    contact_id,
    status,
    viewer_metadata
  ) VALUES (
    v_tenant_id,
    p_presentation_id,
    p_contact_id,
    'pending',
    jsonb_build_object(
      'access_token', v_token,
      'expires_at', (now() + p_expires_in)::text,
      'link_generated_by', auth.uid()
    )
  );
  
  RETURN v_token;
END;
$$;

-- Function to validate presentation token
CREATE OR REPLACE FUNCTION public.validate_presentation_token(
  p_presentation_id UUID,
  p_token TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Find session with matching token
  SELECT 
    id,
    (viewer_metadata->>'expires_at')::timestamp with time zone
  INTO v_session_id, v_expires_at
  FROM public.presentation_sessions
  WHERE presentation_id = p_presentation_id
    AND viewer_metadata->>'access_token' = p_token
    AND status = 'pending';
  
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;
  
  -- Check if expired
  IF v_expires_at < now() THEN
    RAISE EXCEPTION 'Token has expired';
  END IF;
  
  -- Activate session
  UPDATE public.presentation_sessions
  SET 
    status = 'active',
    started_at = now(),
    updated_at = now()
  WHERE id = v_session_id;
  
  RETURN v_session_id;
END;
$$;