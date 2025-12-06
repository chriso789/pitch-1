-- Add portal access fields to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS portal_access_enabled BOOLEAN DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS portal_password_hash TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS portal_access_granted_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS portal_access_granted_by UUID REFERENCES profiles(id);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS portal_last_login_at TIMESTAMPTZ;

-- Add auth_method to homeowner_portal_sessions
ALTER TABLE homeowner_portal_sessions ADD COLUMN IF NOT EXISTS auth_method TEXT DEFAULT 'magic_link';

-- Create index for portal access lookups
CREATE INDEX IF NOT EXISTS idx_contacts_portal_access ON contacts(portal_access_enabled) WHERE portal_access_enabled = true;