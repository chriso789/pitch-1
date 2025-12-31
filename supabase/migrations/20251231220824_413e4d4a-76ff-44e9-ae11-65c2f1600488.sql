-- Add email tracking columns to communication_history
ALTER TABLE communication_history 
ADD COLUMN IF NOT EXISTS resend_message_id text,
ADD COLUMN IF NOT EXISTS email_status text DEFAULT 'sent',
ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
ADD COLUMN IF NOT EXISTS opened_at timestamptz,
ADD COLUMN IF NOT EXISTS opened_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS clicked_at timestamptz,
ADD COLUMN IF NOT EXISTS clicked_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS bounced_at timestamptz,
ADD COLUMN IF NOT EXISTS bounce_reason text;

-- Index for faster webhook lookups
CREATE INDEX IF NOT EXISTS idx_comm_history_resend_id 
ON communication_history(resend_message_id) WHERE resend_message_id IS NOT NULL;

-- Create measurement_approvals table for approved measurements with saved smart tags
CREATE TABLE IF NOT EXISTS measurement_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_entry_id uuid REFERENCES pipeline_entries(id) ON DELETE CASCADE,
  measurement_id uuid,
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz DEFAULT now(),
  saved_tags jsonb NOT NULL DEFAULT '{}',
  approval_notes text,
  report_generated boolean DEFAULT false,
  report_document_id uuid REFERENCES documents(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(pipeline_entry_id, measurement_id)
);

-- Enable RLS on measurement_approvals
ALTER TABLE measurement_approvals ENABLE ROW LEVEL SECURITY;

-- RLS policy for measurement_approvals
CREATE POLICY "Users can access their org approvals"
  ON measurement_approvals FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_measurement_approvals_pipeline 
ON measurement_approvals(pipeline_entry_id);