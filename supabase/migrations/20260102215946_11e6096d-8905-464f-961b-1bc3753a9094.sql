-- Add email threading columns to communication_history
ALTER TABLE communication_history 
ADD COLUMN IF NOT EXISTS thread_id text,
ADD COLUMN IF NOT EXISTS message_id text,
ADD COLUMN IF NOT EXISTS in_reply_to text,
ADD COLUMN IF NOT EXISTS from_address text,
ADD COLUMN IF NOT EXISTS to_address text;

-- Create indexes for efficient thread queries
CREATE INDEX IF NOT EXISTS idx_communication_history_thread_id 
ON communication_history(thread_id);

CREATE INDEX IF NOT EXISTS idx_communication_history_message_id 
ON communication_history(message_id);

CREATE INDEX IF NOT EXISTS idx_communication_history_in_reply_to 
ON communication_history(in_reply_to);

-- Add index for contact email lookups (for matching inbound emails)
CREATE INDEX IF NOT EXISTS idx_contacts_email 
ON contacts(email);

-- Add index for contact matching by phone
CREATE INDEX IF NOT EXISTS idx_contacts_phone 
ON contacts(phone);