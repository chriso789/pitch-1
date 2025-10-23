-- Add Asterisk-specific columns to call_logs
ALTER TABLE call_logs 
ADD COLUMN IF NOT EXISTS asterisk_channel_id TEXT,
ADD COLUMN IF NOT EXISTS asterisk_recording_id TEXT,
ADD COLUMN IF NOT EXISTS bridge_duration_seconds INTEGER;

-- Create did_campaigns table for mapping DIDs to campaigns and routing
CREATE TABLE IF NOT EXISTS did_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  did TEXT NOT NULL,
  campaign_id UUID,
  campaign_name TEXT,
  greeting_message TEXT,
  routing_type TEXT CHECK (routing_type IN ('assigned_agent', 'round_robin', 'ivr', 'voicemail')),
  assigned_agents UUID[],
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_did_campaigns_did ON did_campaigns(did) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_did_campaigns_tenant ON did_campaigns(tenant_id);

ALTER TABLE did_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant DIDs"
  ON did_campaigns FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage their tenant DIDs"
  ON did_campaigns FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Create asterisk_channels table for tracking active calls
CREATE TABLE IF NOT EXISTS asterisk_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL UNIQUE,
  call_log_id UUID REFERENCES call_logs(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  pipeline_entry_id UUID REFERENCES pipeline_entries(id) ON DELETE SET NULL,
  agent_id UUID,
  status TEXT CHECK (status IN ('ringing', 'active', 'on_hold', 'ended')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asterisk_channels_call_log ON asterisk_channels(call_log_id);
CREATE INDEX IF NOT EXISTS idx_asterisk_channels_status ON asterisk_channels(status) WHERE status != 'ended';
CREATE INDEX IF NOT EXISTS idx_asterisk_channels_tenant ON asterisk_channels(tenant_id);

ALTER TABLE asterisk_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant channels"
  ON asterisk_channels FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Service role can manage channels"
  ON asterisk_channels FOR ALL
  USING (true);

-- Create communication_preferences table
CREATE TABLE IF NOT EXISTS communication_preferences (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  asterisk_api_url TEXT,
  asterisk_api_token TEXT,
  recording_enabled BOOLEAN DEFAULT true,
  recording_announcement BOOLEAN DEFAULT true,
  voicemail_enabled BOOLEAN DEFAULT true,
  voicemail_email TEXT,
  sms_enabled BOOLEAN DEFAULT true,
  sms_from_number TEXT,
  email_enabled BOOLEAN DEFAULT true,
  email_from_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE communication_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant communication preferences"
  ON communication_preferences FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage their tenant communication preferences"
  ON communication_preferences FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));