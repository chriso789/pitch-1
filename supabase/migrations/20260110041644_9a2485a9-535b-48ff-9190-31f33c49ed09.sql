-- ============================================
-- MULTI-TENANT TELNYX CONVERSATIONS SYSTEM
-- ============================================

-- 1. Create conversations table (unified threads for SMS/Call/Email)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'call', 'email')),
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  contact_phone_e164 TEXT,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, contact_id, channel, location_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_contact ON conversations(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_location ON conversations(tenant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_activity ON conversations(tenant_id, last_activity_at DESC);

-- 2. Create telnyx_webhook_events audit table
CREATE TABLE IF NOT EXISTS telnyx_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('messaging', 'voice')),
  event_type TEXT,
  telnyx_event_id TEXT,
  occurred_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant ON telnyx_webhook_events(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON telnyx_webhook_events(event_type);

-- 3. Create ai_agents configuration table
CREATE TABLE IF NOT EXISTS ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Follow-Up Assistant',
  enabled BOOLEAN NOT NULL DEFAULT false,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  persona_prompt TEXT NOT NULL DEFAULT 'You are a helpful assistant for a home services company. Be friendly, professional, and helpful. Your goal is to schedule appointments and answer basic questions about our services.',
  safety_prompt TEXT NOT NULL DEFAULT 'Never claim to be human. Never provide specific pricing without scheduling an inspection first. Respect STOP requests immediately. Only contact during business hours.',
  working_hours JSONB NOT NULL DEFAULT '{"tz":"America/New_York","days":[1,2,3,4,5],"start":"09:00","end":"18:00"}',
  escalation_rules JSONB NOT NULL DEFAULT '{"keywords":["lawyer","attorney","insurance claim","complaint"],"sentiment_threshold":-0.5}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_tenant ON ai_agents(tenant_id);

-- 4. Create ai_outreach_queue table
CREATE TABLE IF NOT EXISTS ai_outreach_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'call')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed', 'canceled')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_queue_scheduled ON ai_outreach_queue(state, scheduled_for) WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS idx_ai_queue_tenant ON ai_outreach_queue(tenant_id, contact_id);

-- 5. Add columns to calls table (if they don't exist)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS telnyx_call_leg_id TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS raw_payload JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_calls_leg ON calls(telnyx_call_leg_id) WHERE telnyx_call_leg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_conversation ON calls(conversation_id) WHERE conversation_id IS NOT NULL;

-- 6. Add conversation_id to sms_messages
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_messages_conversation ON sms_messages(conversation_id) WHERE conversation_id IS NOT NULL;

-- 7. Create RPC function to get or create conversation
CREATE OR REPLACE FUNCTION rpc_create_or_get_conversation(
  _tenant_id UUID,
  _contact_id UUID,
  _channel TEXT,
  _location_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE 
  _id UUID;
  _phone TEXT;
BEGIN
  -- Find existing conversation
  SELECT c.id INTO _id
  FROM conversations c
  WHERE c.tenant_id = _tenant_id
    AND c.contact_id = _contact_id
    AND c.channel = _channel
    AND (c.location_id = _location_id OR (c.location_id IS NULL AND _location_id IS NULL));

  IF _id IS NULL THEN
    -- Get contact phone for reference
    SELECT phone INTO _phone
    FROM contacts
    WHERE id = _contact_id AND tenant_id = _tenant_id;
    
    -- Create new conversation
    INSERT INTO conversations(tenant_id, contact_id, channel, location_id, contact_phone_e164)
    VALUES (_tenant_id, _contact_id, _channel, _location_id, _phone)
    RETURNING id INTO _id;
  ELSE
    -- Update last activity
    UPDATE conversations 
    SET last_activity_at = NOW(), updated_at = NOW() 
    WHERE id = _id;
  END IF;

  RETURN _id;
END;
$$;

-- 8. Enable RLS on new tables
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE telnyx_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_outreach_queue ENABLE ROW LEVEL SECURITY;

-- 9. Create RLS policies for conversations
CREATE POLICY "Users can view conversations in their tenant" 
  ON conversations FOR SELECT 
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert conversations in their tenant" 
  ON conversations FOR INSERT 
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update conversations in their tenant" 
  ON conversations FOR UPDATE 
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- 10. Create RLS policies for telnyx_webhook_events (read-only for users)
CREATE POLICY "Users can view webhook events in their tenant" 
  ON telnyx_webhook_events FOR SELECT 
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- 11. Create RLS policies for ai_agents
CREATE POLICY "Users can view AI agents in their tenant" 
  ON ai_agents FOR SELECT 
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert AI agents in their tenant" 
  ON ai_agents FOR INSERT 
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update AI agents in their tenant" 
  ON ai_agents FOR UPDATE 
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete AI agents in their tenant" 
  ON ai_agents FOR DELETE 
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- 12. Create RLS policies for ai_outreach_queue
CREATE POLICY "Users can view outreach queue in their tenant" 
  ON ai_outreach_queue FOR SELECT 
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert into outreach queue in their tenant" 
  ON ai_outreach_queue FOR INSERT 
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update outreach queue in their tenant" 
  ON ai_outreach_queue FOR UPDATE 
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete from outreach queue in their tenant" 
  ON ai_outreach_queue FOR DELETE 
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- 13. Create trigger for updated_at on new tables
CREATE OR REPLACE FUNCTION update_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_conversations_updated_at();

CREATE TRIGGER update_ai_agents_updated_at
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW
  EXECUTE FUNCTION update_conversations_updated_at();

CREATE TRIGGER update_ai_outreach_queue_updated_at
  BEFORE UPDATE ON ai_outreach_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_conversations_updated_at();