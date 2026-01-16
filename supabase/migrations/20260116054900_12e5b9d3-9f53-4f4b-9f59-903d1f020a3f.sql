-- ============================================
-- AI CONVERSATIONS AND MESSAGES TABLES
-- ============================================

-- 1. Create ai_conversations table (audit trail for AI interactions)
CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'call')),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed', 'escalated')),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, contact_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant_contact ON ai_conversations(tenant_id, contact_id, channel);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_state ON ai_conversations(tenant_id, state) WHERE state != 'closed';

-- Enable RLS
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their tenant's AI conversations" ON ai_conversations;
CREATE POLICY "Users can view their tenant's AI conversations"
  ON ai_conversations FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage their tenant's AI conversations" ON ai_conversations;
CREATE POLICY "Users can manage their tenant's AI conversations"
  ON ai_conversations FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- 2. Create ai_messages table (individual messages in AI conversations)
CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system')),
  content TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_convo ON ai_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_messages_tenant ON ai_messages(tenant_id, created_at DESC);

-- Enable RLS
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their tenant's AI messages" ON ai_messages;
CREATE POLICY "Users can view their tenant's AI messages"
  ON ai_messages FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert AI messages for their tenant" ON ai_messages;
CREATE POLICY "Users can insert AI messages for their tenant"
  ON ai_messages FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));