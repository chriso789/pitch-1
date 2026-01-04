-- Add enhanced email logging columns
ALTER TABLE onboarding_email_log 
ADD COLUMN IF NOT EXISTS email_type TEXT,
ADD COLUMN IF NOT EXISTS email_body TEXT,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_onboarding_email_log_type ON onboarding_email_log(email_type);
CREATE INDEX IF NOT EXISTS idx_onboarding_email_log_expires ON onboarding_email_log(expires_at);

COMMENT ON COLUMN onboarding_email_log.email_type IS 'Type: owner_invite, user_invite, password_reset, demo_request';
COMMENT ON COLUMN onboarding_email_log.email_body IS 'Full HTML body for debugging';
COMMENT ON COLUMN onboarding_email_log.expires_at IS 'When the password setup link expires';