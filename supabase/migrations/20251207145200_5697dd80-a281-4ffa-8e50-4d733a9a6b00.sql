-- ============================================
-- UNIFIED COMMUNICATIONS HUB SCHEMA
-- ============================================

-- Unified inbox for all communications
CREATE TABLE IF NOT EXISTS public.unified_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'call', 'email', 'voicemail')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT,
  subject TEXT,
  phone_number TEXT,
  is_read BOOLEAN DEFAULT false,
  is_starred BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  related_call_id UUID REFERENCES public.call_logs(id) ON DELETE SET NULL,
  related_message_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Call recordings management table
CREATE TABLE IF NOT EXISTS public.call_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  call_log_id UUID REFERENCES public.call_logs(id) ON DELETE CASCADE,
  recording_url TEXT NOT NULL,
  recording_sid TEXT,
  duration_seconds INTEGER,
  file_size_bytes INTEGER,
  transcription TEXT,
  transcription_status TEXT DEFAULT 'pending' CHECK (transcription_status IN ('pending', 'processing', 'completed', 'failed')),
  ai_summary TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  keywords TEXT[],
  is_starred BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS conversation threads
CREATE TABLE IF NOT EXISTS public.sms_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT,
  unread_count INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT false,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS messages within threads
CREATE TABLE IF NOT EXISTS public.sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.sms_threads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'received')),
  provider TEXT CHECK (provider IN ('telnyx', 'twilio')),
  provider_message_id TEXT,
  media_urls TEXT[],
  is_read BOOLEAN DEFAULT false,
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Power dialer sessions
CREATE TABLE IF NOT EXISTS public.dialer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.dialer_campaigns(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  calls_made INTEGER DEFAULT 0,
  calls_answered INTEGER DEFAULT 0,
  calls_voicemail INTEGER DEFAULT 0,
  total_talk_time_seconds INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_unified_inbox_tenant_created ON public.unified_inbox(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unified_inbox_contact ON public.unified_inbox(contact_id);
CREATE INDEX IF NOT EXISTS idx_unified_inbox_unread ON public.unified_inbox(tenant_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_call_recordings_tenant ON public.call_recordings(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_recordings_call_log ON public.call_recordings(call_log_id);
CREATE INDEX IF NOT EXISTS idx_sms_threads_tenant ON public.sms_threads(tenant_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_threads_phone ON public.sms_threads(tenant_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_sms_messages_thread ON public.sms_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialer_sessions_user ON public.dialer_sessions(user_id, started_at DESC);

-- Enable RLS
ALTER TABLE public.unified_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for unified_inbox
CREATE POLICY "Users can view their tenant inbox" ON public.unified_inbox
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can insert inbox items" ON public.unified_inbox
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update their tenant inbox" ON public.unified_inbox
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

-- RLS Policies for call_recordings
CREATE POLICY "Users can view their tenant recordings" ON public.call_recordings
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can insert recordings" ON public.call_recordings
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update their tenant recordings" ON public.call_recordings
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

-- RLS Policies for sms_threads
CREATE POLICY "Users can view their tenant threads" ON public.sms_threads
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can insert threads" ON public.sms_threads
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update their tenant threads" ON public.sms_threads
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

-- RLS Policies for sms_messages
CREATE POLICY "Users can view their tenant messages" ON public.sms_messages
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can insert messages" ON public.sms_messages
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

-- RLS Policies for dialer_sessions
CREATE POLICY "Users can view their tenant sessions" ON public.dialer_sessions
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can manage their own sessions" ON public.dialer_sessions
  FOR ALL USING (user_id = auth.uid());

-- Function to update SMS thread on new message
CREATE OR REPLACE FUNCTION public.update_sms_thread_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.sms_threads
  SET 
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(NEW.body, 100),
    unread_count = CASE WHEN NEW.direction = 'inbound' THEN unread_count + 1 ELSE unread_count END,
    updated_at = NOW()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_update_sms_thread
  AFTER INSERT ON public.sms_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sms_thread_on_message();

-- Function to sync to unified inbox
CREATE OR REPLACE FUNCTION public.sync_sms_to_unified_inbox()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.unified_inbox (
    tenant_id, contact_id, channel, direction, content, phone_number,
    is_read, related_message_id, metadata
  ) VALUES (
    NEW.tenant_id,
    NEW.contact_id,
    'sms',
    NEW.direction,
    NEW.body,
    CASE WHEN NEW.direction = 'inbound' THEN NEW.from_number ELSE NEW.to_number END,
    NEW.direction = 'outbound',
    NEW.id,
    jsonb_build_object('thread_id', NEW.thread_id, 'provider', NEW.provider)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_sync_sms_to_inbox
  AFTER INSERT ON public.sms_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_sms_to_unified_inbox();

-- Updated_at triggers
CREATE TRIGGER update_unified_inbox_updated_at
  BEFORE UPDATE ON public.unified_inbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_call_recordings_updated_at
  BEFORE UPDATE ON public.call_recordings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sms_threads_updated_at
  BEFORE UPDATE ON public.sms_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();