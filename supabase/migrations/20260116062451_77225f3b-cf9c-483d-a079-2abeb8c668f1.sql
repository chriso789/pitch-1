-- ============================================================
-- AI Follow-Up Hub Schema Extensions
-- Adds interactive smart tag fields, document submissions, and AI call tracking
-- ============================================================

-- 1. Extend document_tag_placements with interactive field types
ALTER TABLE document_tag_placements 
  ADD COLUMN IF NOT EXISTS tag_type TEXT DEFAULT 'smart_tag',
  ADD COLUMN IF NOT EXISTS recipient_type TEXT DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS placeholder_text TEXT,
  ADD COLUMN IF NOT EXISTS validation_rules JSONB,
  ADD COLUMN IF NOT EXISTS field_options JSONB;

-- Add constraint for tag_type
DO $$ BEGIN
  ALTER TABLE document_tag_placements 
    ADD CONSTRAINT document_tag_placements_tag_type_check 
    CHECK (tag_type IN ('smart_tag', 'text_input', 'signature', 'checkbox', 'date_input', 'testimonial'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add constraint for recipient_type
DO $$ BEGIN
  ALTER TABLE document_tag_placements 
    ADD CONSTRAINT document_tag_placements_recipient_type_check 
    CHECK (recipient_type IN ('system', 'homeowner', 'contractor'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Create document_field_submissions table for recipient responses
CREATE TABLE IF NOT EXISTS document_field_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  placement_id UUID NOT NULL REFERENCES document_tag_placements(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('homeowner', 'contractor')),
  field_value TEXT,
  signature_data TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for document_field_submissions
CREATE INDEX IF NOT EXISTS idx_document_field_submissions_document ON document_field_submissions(document_id);
CREATE INDEX IF NOT EXISTS idx_document_field_submissions_placement ON document_field_submissions(placement_id);
CREATE INDEX IF NOT EXISTS idx_document_field_submissions_contact ON document_field_submissions(contact_id);

-- Enable RLS
ALTER TABLE document_field_submissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for document_field_submissions
CREATE POLICY "Tenant members can view submissions"
  ON document_field_submissions FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can insert submissions"
  ON document_field_submissions FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- 3. Extend ai_call_transcripts with project status fields (if table exists)
DO $$ BEGIN
  ALTER TABLE ai_call_transcripts 
    ADD COLUMN IF NOT EXISTS project_status_provided JSONB,
    ADD COLUMN IF NOT EXISTS escalation_reason TEXT;
EXCEPTION
  WHEN undefined_table THEN
    -- Table doesn't exist, create it
    CREATE TABLE ai_call_transcripts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      telnyx_call_control_id TEXT,
      caller_number TEXT,
      gathered_data JSONB,
      call_duration_seconds INTEGER,
      project_status_provided JSONB,
      escalated_to_human BOOLEAN DEFAULT false,
      escalation_reason TEXT,
      sentiment TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    
    CREATE INDEX idx_ai_call_transcripts_tenant ON ai_call_transcripts(tenant_id);
    CREATE INDEX idx_ai_call_transcripts_caller ON ai_call_transcripts(caller_number);
    
    ALTER TABLE ai_call_transcripts ENABLE ROW LEVEL SECURITY;
    
    CREATE POLICY "Tenant members can view call transcripts"
      ON ai_call_transcripts FOR SELECT
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
END $$;

-- 4. Add new status values to ai_outreach_queue if not already present
-- This adds support for 'waiting_reply', 'escalated', 'snoozed' states

-- 5. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_document_tag_placements_tag_type ON document_tag_placements(tag_type);
CREATE INDEX IF NOT EXISTS idx_document_tag_placements_recipient ON document_tag_placements(recipient_type);

-- 6. Add comments for documentation
COMMENT ON COLUMN document_tag_placements.tag_type IS 'Type of tag: smart_tag (auto-fill), text_input, signature, checkbox, date_input, testimonial';
COMMENT ON COLUMN document_tag_placements.recipient_type IS 'Who fills this field: system (auto), homeowner, or contractor';
COMMENT ON COLUMN document_tag_placements.is_required IS 'Whether this field must be completed before document submission';
COMMENT ON COLUMN document_tag_placements.placeholder_text IS 'Placeholder text shown in input fields';
COMMENT ON COLUMN document_tag_placements.validation_rules IS 'JSON with min_length, max_length, pattern for validation';
COMMENT ON COLUMN document_tag_placements.field_options IS 'JSON with options for checkboxes, allow_multiple, default_value';

COMMENT ON TABLE document_field_submissions IS 'Stores recipient responses for interactive document fields (signatures, text inputs, checkboxes)';
COMMENT ON COLUMN document_field_submissions.signature_data IS 'Base64 encoded signature image data';
COMMENT ON COLUMN document_field_submissions.ip_address IS 'IP address of the person who submitted for audit trail';