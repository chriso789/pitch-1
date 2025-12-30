-- Soft-delete completely empty contacts from failed imports
-- These are contacts with no useful data (no email, phone, or address)
UPDATE contacts
SET 
  is_deleted = true,
  updated_at = NOW()
WHERE 
  (is_deleted = false OR is_deleted IS NULL)
  AND (first_name = 'Unknown' OR first_name IS NULL OR first_name = '')
  AND (email IS NULL OR email = '')
  AND (phone IS NULL OR phone = '')
  AND (address_street IS NULL OR address_street = '');