-- ================================================
-- 1) FIX STORAGE.BUCKETS RLS - Allow authenticated users to see public buckets
-- ================================================
CREATE POLICY "Authenticated users can see public buckets"
ON storage.buckets FOR SELECT
TO authenticated
USING (public = true);

-- ================================================
-- 2) UNMATCHED INBOUND TABLE - Store messages/calls from unknown numbers
-- ================================================
CREATE TABLE IF NOT EXISTS unmatched_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms','call')),
  from_e164 TEXT NOT NULL,
  to_e164 TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  event_type TEXT,
  telnyx_event_id TEXT,
  telnyx_message_id TEXT,
  telnyx_call_control_id TEXT,
  telnyx_call_leg_id TEXT,
  body TEXT,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','linked','ignored')),
  notes TEXT,
  occurred_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_unmatched_tenant_state_time 
  ON unmatched_inbound(tenant_id, state, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_unmatched_tenant_from 
  ON unmatched_inbound(tenant_id, from_e164);
CREATE INDEX IF NOT EXISTS idx_unmatched_telnyx_message_id 
  ON unmatched_inbound(telnyx_message_id) WHERE telnyx_message_id IS NOT NULL;

-- Enable RLS
ALTER TABLE unmatched_inbound ENABLE ROW LEVEL SECURITY;

-- RLS policy for tenant isolation
CREATE POLICY "Users can access their tenant's unmatched inbound"
ON unmatched_inbound FOR ALL
USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ================================================
-- 3) MESSAGE DEDUPLICATION - Prevent duplicate messages from webhook retries
-- ================================================

-- Ensure telnyx_message_id column exists on sms_messages
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS telnyx_message_id TEXT;

-- Create partial unique index (ignores null/empty values)
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_unique_tenant_telnyx_id
  ON sms_messages(tenant_id, telnyx_message_id)
  WHERE telnyx_message_id IS NOT NULL AND telnyx_message_id <> '';