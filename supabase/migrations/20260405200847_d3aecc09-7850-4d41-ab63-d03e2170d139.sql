
-- ============================================
-- 1. Create voicemail_recordings table
-- ============================================
CREATE TABLE IF NOT EXISTS public.voicemail_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  call_id UUID REFERENCES public.calls(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.voicemail_templates(id) ON DELETE SET NULL,
  storage_path TEXT,
  recording_url TEXT,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  dropped_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.voicemail_recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view voicemail_recordings"
  ON public.voicemail_recordings FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT COALESCE(p.active_tenant_id, p.tenant_id)
    FROM public.profiles p WHERE p.id = auth.uid()
  ));

CREATE POLICY "Tenant members can insert voicemail_recordings"
  ON public.voicemail_recordings FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (
    SELECT COALESCE(p.active_tenant_id, p.tenant_id)
    FROM public.profiles p WHERE p.id = auth.uid()
  ));

CREATE POLICY "Tenant members can update voicemail_recordings"
  ON public.voicemail_recordings FOR UPDATE TO authenticated
  USING (tenant_id IN (
    SELECT COALESCE(p.active_tenant_id, p.tenant_id)
    FROM public.profiles p WHERE p.id = auth.uid()
  ));

CREATE INDEX idx_voicemail_recordings_tenant ON public.voicemail_recordings(tenant_id);
CREATE INDEX idx_voicemail_recordings_call ON public.voicemail_recordings(call_id);

-- ============================================
-- 2. Trigger: populate unified_inbox from completed calls
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_calls_to_unified_inbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when status transitions TO 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    INSERT INTO public.unified_inbox (
      tenant_id, contact_id, channel, direction, content,
      phone_number, related_call_id, is_read, metadata, created_at
    ) VALUES (
      NEW.tenant_id,
      NEW.contact_id,
      'call',
      COALESCE(NEW.direction, 'outbound'),
      COALESCE(
        'Call (' || COALESCE(NEW.duration_seconds || 's', 'unknown duration') || ')',
        'Call completed'
      ),
      COALESCE(NEW.to_number, NEW.from_number),
      NEW.id,
      false,
      jsonb_build_object(
        'call_type', COALESCE(NEW.call_type, 'standard'),
        'duration_seconds', NEW.duration_seconds,
        'recording_url', NEW.recording_url
      ),
      COALESCE(NEW.ended_at, now())
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calls_to_unified_inbox ON public.calls;
CREATE TRIGGER trg_calls_to_unified_inbox
  AFTER UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_calls_to_unified_inbox();

-- ============================================
-- 3. Trigger: populate unified_inbox from inbound SMS
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_sms_to_unified_inbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    INSERT INTO public.unified_inbox (
      tenant_id, contact_id, channel, direction, content,
      phone_number, related_message_id, is_read, metadata, created_at
    ) VALUES (
      NEW.tenant_id,
      NEW.contact_id,
      'sms',
      'inbound',
      LEFT(NEW.body, 500),
      NEW.from_number,
      NEW.id,
      false,
      jsonb_build_object('thread_id', NEW.thread_id),
      NEW.created_at
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sms_to_unified_inbox ON public.sms_messages;
CREATE TRIGGER trg_sms_to_unified_inbox
  AFTER INSERT ON public.sms_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sms_to_unified_inbox();

-- ============================================
-- 4. Trigger: auto-create call_recordings row when recording_url is set
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_sync_call_recording()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.recording_url IS NOT NULL 
     AND (OLD.recording_url IS NULL OR OLD.recording_url <> NEW.recording_url)
     AND NEW.tenant_id IS NOT NULL THEN
    INSERT INTO public.call_recordings (
      tenant_id, call_log_id, recording_url, duration_seconds, 
      transcription, transcription_status, status, created_at
    ) VALUES (
      NEW.tenant_id,
      NEW.id,
      NEW.recording_url,
      NEW.duration_seconds,
      NEW.transcript,
      CASE WHEN NEW.transcript IS NOT NULL THEN 'completed' ELSE 'pending' END,
      'completed',
      now()
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_call_recording ON public.calls;
CREATE TRIGGER trg_sync_call_recording
  AFTER UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_call_recording();
