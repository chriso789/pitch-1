-- Add missing columns to contacts table for lead scoring
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_status VARCHAR(50) DEFAULT 'new';

CREATE INDEX IF NOT EXISTS idx_contacts_lead_score ON contacts(lead_score);
CREATE INDEX IF NOT EXISTS idx_contacts_lead_status ON contacts(lead_status);

-- Update lead_scoring_rules schema to match expected structure
ALTER TABLE lead_scoring_rules ADD COLUMN IF NOT EXISTS operator VARCHAR(50) DEFAULT 'equals';
ALTER TABLE lead_scoring_rules ADD COLUMN IF NOT EXISTS field_value TEXT;
ALTER TABLE lead_scoring_rules DROP COLUMN IF EXISTS rule_type;
ALTER TABLE lead_scoring_rules DROP COLUMN IF EXISTS condition_type;
ALTER TABLE lead_scoring_rules DROP COLUMN IF EXISTS condition_value;