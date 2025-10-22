-- Phase 1: Database Schema Enhancement

-- 1.1 Create call_transcripts table for ASR storage
CREATE TABLE IF NOT EXISTS call_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  transcript_text TEXT NOT NULL,
  speaker TEXT,
  timestamp_ms INTEGER NOT NULL,
  is_partial BOOLEAN DEFAULT true,
  confidence FLOAT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_call_transcripts_call_id ON call_transcripts(call_id);
CREATE INDEX idx_call_transcripts_tenant_id ON call_transcripts(tenant_id);
CREATE INDEX idx_call_transcripts_created_at ON call_transcripts(created_at DESC);

-- Enable Realtime for live agent-assist
ALTER PUBLICATION supabase_realtime ADD TABLE call_transcripts;

-- RLS Policies
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transcripts in their tenant"
  ON call_transcripts FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Service role can insert transcripts"
  ON call_transcripts FOR INSERT
  WITH CHECK (true);

-- 1.2 Create call_events table for campaign metrics
CREATE TABLE IF NOT EXISTS call_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES dialer_campaigns(id) ON DELETE SET NULL,
  telnyx_call_control_id TEXT,
  event_type TEXT NOT NULL,
  event_data JSONB,
  client_state JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT valid_event_type CHECK (
    event_type IN ('call.initiated', 'call.answered', 'call.bridged', 'call.hangup', 'call.machine.detection.ended')
  )
);

CREATE INDEX idx_call_events_call_id ON call_events(call_id);
CREATE INDEX idx_call_events_campaign_id ON call_events(campaign_id);
CREATE INDEX idx_call_events_event_type ON call_events(event_type);
CREATE INDEX idx_call_events_created_at ON call_events(created_at DESC);

ALTER TABLE call_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view events in their tenant"
  ON call_events FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- 1.3 Enhance calls table with Telnyx fields
ALTER TABLE calls 
  ADD COLUMN IF NOT EXISTS telnyx_call_control_id TEXT,
  ADD COLUMN IF NOT EXISTS recording_url TEXT,
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES dialer_campaigns(id),
  ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS handled_by UUID REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS idx_calls_telnyx_id ON calls(telnyx_call_control_id);
CREATE INDEX IF NOT EXISTS idx_calls_campaign_id ON calls(campaign_id);

-- 1.4 Enhance dialer_campaigns with metrics fields
ALTER TABLE dialer_campaigns
  ADD COLUMN IF NOT EXISTS total_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_answered INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bridged INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_talk_time_seconds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS caller_id TEXT,
  ADD COLUMN IF NOT EXISTS max_parallel_calls INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Helper functions for campaign metrics
CREATE OR REPLACE FUNCTION increment_campaign_attempts(p_campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE dialer_campaigns
  SET total_attempts = total_attempts + 1
  WHERE id = p_campaign_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_campaign_answered(p_campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE dialer_campaigns
  SET total_answered = total_answered + 1
  WHERE id = p_campaign_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_campaign_bridged(p_campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE dialer_campaigns
  SET total_bridged = total_bridged + 1
  WHERE id = p_campaign_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_campaign_avg_talk_time(p_campaign_id UUID, p_duration INTEGER)
RETURNS VOID AS $$
DECLARE
  v_total_bridged INTEGER;
  v_current_avg INTEGER;
BEGIN
  SELECT total_bridged, avg_talk_time_seconds 
  INTO v_total_bridged, v_current_avg
  FROM dialer_campaigns 
  WHERE id = p_campaign_id;
  
  IF v_total_bridged > 0 THEN
    UPDATE dialer_campaigns
    SET avg_talk_time_seconds = ((v_current_avg * (v_total_bridged - 1)) + p_duration) / v_total_bridged
    WHERE id = p_campaign_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;