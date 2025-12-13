-- AI Answering Service Configuration per tenant
CREATE TABLE IF NOT EXISTS ai_answering_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  is_enabled BOOLEAN DEFAULT true,
  greeting_text TEXT DEFAULT 'Hi, thanks for calling. I''ll ask a few questions to better assist you.',
  ai_voice TEXT DEFAULT 'en-US-Wavenet-D',
  ai_model TEXT DEFAULT 'gpt-3.5-turbo',
  temperature NUMERIC(3,2) DEFAULT 0.2,
  required_fields TEXT[] DEFAULT ARRAY['name', 'service', 'callback_number'],
  escalation_keywords TEXT[] DEFAULT ARRAY['human', 'agent', 'person', 'operator', 'representative'],
  business_hours JSONB DEFAULT '{"start": "09:00", "end": "17:00", "timezone": "America/New_York"}',
  after_hours_greeting TEXT DEFAULT 'Thank you for calling. Our office is currently closed. Please leave your information and we will call you back during business hours.',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

-- AI Call Transcripts for analytics and audit
CREATE TABLE IF NOT EXISTS ai_call_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  telnyx_call_control_id TEXT,
  caller_number TEXT,
  gathered_data JSONB,
  sentiment TEXT,
  call_duration_seconds INTEGER,
  escalated_to_human BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE ai_answering_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_call_transcripts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_answering_config
CREATE POLICY "Users can view their tenant's AI config" ON ai_answering_config
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage AI config" ON ai_answering_config
  FOR ALL USING (
    tenant_id = get_user_tenant_id() AND
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('master', 'corporate', 'office_admin')
    )
  );

-- RLS Policies for ai_call_transcripts
CREATE POLICY "Users can view their tenant's AI transcripts" ON ai_call_transcripts
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert AI transcripts" ON ai_call_transcripts
  FOR INSERT WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_call_transcripts_tenant ON ai_call_transcripts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_call_transcripts_created ON ai_call_transcripts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_answering_config_tenant ON ai_answering_config(tenant_id);

-- Insert default config for O'Brien Contracting
INSERT INTO ai_answering_config (tenant_id, greeting_text)
SELECT id, 'Hi, thanks for calling O''Brien Contracting. I''ll ask a few quick questions to connect you with the right team member.'
FROM tenants WHERE name ILIKE '%O''Brien%'
ON CONFLICT (tenant_id) DO NOTHING;