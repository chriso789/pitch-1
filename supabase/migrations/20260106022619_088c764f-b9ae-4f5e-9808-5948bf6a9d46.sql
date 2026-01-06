-- Add indexes for faster duplicate detection during bulk imports
-- These indexes help the duplicate detection trigger run in O(log n) instead of O(n)

-- Index on normalized phone (using btree for exact matches)
CREATE INDEX IF NOT EXISTS idx_contacts_phone_tenant 
ON public.contacts (tenant_id, phone) 
WHERE phone IS NOT NULL AND is_deleted = false;

-- Index on email (lowercase for case-insensitive matches)
CREATE INDEX IF NOT EXISTS idx_contacts_email_tenant 
ON public.contacts (tenant_id, lower(email)) 
WHERE email IS NOT NULL AND is_deleted = false;

-- Composite index for recent contacts (helps limit duplicate checking to recent imports)
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_created 
ON public.contacts (tenant_id, created_at DESC) 
WHERE is_deleted = false;