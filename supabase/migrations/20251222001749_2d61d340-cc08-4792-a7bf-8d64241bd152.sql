-- Add secondary email and phone columns to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS secondary_email TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS secondary_phone TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS additional_emails TEXT[] DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS additional_phones TEXT[] DEFAULT '{}';