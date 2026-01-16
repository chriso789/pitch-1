-- ============================================
-- AI FOLLOW-UP HUB SCHEMA EXTENSIONS (COMPLETE)
-- ============================================

-- 1. Create ai_contact_memory table (what the AI "knows" about each contact)
CREATE TABLE IF NOT EXISTS ai_contact_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  last_touch_at TIMESTAMPTZ,
  last_response_at TIMESTAMPTZ,
  risk_flags TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_contact_memory_contact ON ai_contact_memory(tenant_id, contact_id);

-- Enable RLS
ALTER TABLE ai_contact_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their tenant's contact memory" ON ai_contact_memory;
CREATE POLICY "Users can view their tenant's contact memory"
  ON ai_contact_memory FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert their tenant's contact memory" ON ai_contact_memory;
CREATE POLICY "Users can insert their tenant's contact memory"
  ON ai_contact_memory FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update their tenant's contact memory" ON ai_contact_memory;
CREATE POLICY "Users can update their tenant's contact memory"
  ON ai_contact_memory FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- 2. Create v_ai_aged_contacts view (identifies dormant leads)
CREATE OR REPLACE VIEW v_ai_aged_contacts AS
SELECT
  c.id AS contact_id,
  c.tenant_id,
  c.first_name,
  c.last_name,
  c.phone,
  c.email,
  c.type AS contact_type,
  c.qualification_status,
  c.lead_source,
  COALESCE(
    GREATEST(
      MAX(ui.created_at),
      MAX(sm.sent_at),
      MAX(ch.created_at)
    ),
    c.created_at
  ) AS last_activity_at,
  EXTRACT(DAY FROM now() - COALESCE(
    GREATEST(
      MAX(ui.created_at),
      MAX(sm.sent_at),
      MAX(ch.created_at)
    ),
    c.created_at
  )) AS days_dormant,
  EXISTS (
    SELECT 1 FROM ai_contact_memory acm 
    WHERE acm.contact_id = c.id 
    AND 'do_not_contact' = ANY(acm.risk_flags)
  ) AS is_opted_out,
  EXISTS (
    SELECT 1 FROM ai_outreach_queue aoq 
    WHERE aoq.contact_id = c.id 
    AND aoq.state IN ('queued', 'running')
  ) AS has_pending_outreach
FROM contacts c
LEFT JOIN unified_inbox ui ON ui.tenant_id = c.tenant_id AND ui.contact_id = c.id
LEFT JOIN sms_messages sm ON sm.tenant_id = c.tenant_id AND sm.contact_id = c.id
LEFT JOIN communication_history ch ON ch.tenant_id = c.tenant_id AND ch.contact_id = c.id
WHERE c.qualification_status NOT IN ('closed_won', 'closed_lost')
   OR c.qualification_status IS NULL
GROUP BY c.id, c.tenant_id, c.first_name, c.last_name, c.phone, c.email, c.type, c.qualification_status, c.lead_source, c.created_at;

-- 3. Add updated_at trigger for ai_contact_memory
CREATE OR REPLACE FUNCTION update_ai_contact_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_contact_memory_updated_at ON ai_contact_memory;
CREATE TRIGGER trg_ai_contact_memory_updated_at
  BEFORE UPDATE ON ai_contact_memory
  FOR EACH ROW EXECUTE FUNCTION update_ai_contact_memory_updated_at();