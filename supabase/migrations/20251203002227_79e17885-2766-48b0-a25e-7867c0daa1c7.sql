-- Voice recordings storage for sales reps
CREATE TABLE IF NOT EXISTS public.voice_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  pipeline_entry_id UUID REFERENCES pipeline_entries(id) ON DELETE SET NULL,
  recording_url TEXT NOT NULL,
  duration_seconds INTEGER,
  file_size_bytes INTEGER,
  transcript TEXT,
  ai_summary TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI chat sessions for persistence
CREATE TABLE IF NOT EXISTS public.ai_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  session_type TEXT DEFAULT 'general' CHECK (session_type IN ('general', 'lead_assist', 'task_planning', 'pipeline_review')),
  context JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI chat messages for conversation history
CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  voice_recording_id UUID REFERENCES voice_recordings(id) ON DELETE SET NULL,
  actions_taken JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE voice_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for voice_recordings
CREATE POLICY "Users can view own recordings" ON voice_recordings
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own recordings" ON voice_recordings
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- RLS Policies for ai_chat_sessions
CREATE POLICY "Users can view own sessions" ON ai_chat_sessions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own sessions" ON ai_chat_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own sessions" ON ai_chat_sessions
  FOR UPDATE USING (user_id = auth.uid());

-- RLS Policies for ai_chat_messages
CREATE POLICY "Users can view messages from own sessions" ON ai_chat_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM ai_chat_sessions WHERE id = session_id AND user_id = auth.uid())
  );

CREATE POLICY "Users can insert messages to own sessions" ON ai_chat_messages
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM ai_chat_sessions WHERE id = session_id AND user_id = auth.uid())
  );

-- Indexes for performance
CREATE INDEX idx_voice_recordings_user ON voice_recordings(user_id, created_at DESC);
CREATE INDEX idx_voice_recordings_tenant ON voice_recordings(tenant_id);
CREATE INDEX idx_ai_chat_sessions_user ON ai_chat_sessions(user_id, last_message_at DESC);
CREATE INDEX idx_ai_chat_messages_session ON ai_chat_messages(session_id, created_at);

-- Create storage bucket for voice recordings
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-recordings', 'voice-recordings', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload own recordings" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'voice-recordings' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view own recordings" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'voice-recordings' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );