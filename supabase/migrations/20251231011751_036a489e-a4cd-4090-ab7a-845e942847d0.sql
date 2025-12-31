-- Enable RLS on contact_renumber_audit table
ALTER TABLE public.contact_renumber_audit ENABLE ROW LEVEL SECURITY;

-- This is an audit table - only high-level roles should be able to view it
-- No one should be able to modify audit records (they're created by system triggers)
CREATE POLICY "High level roles can view audit records"
ON public.contact_renumber_audit
FOR SELECT
TO authenticated
USING (
  has_high_level_role(auth.uid())
);

-- Prevent any direct inserts/updates/deletes from API
-- Audit records should only be created by database triggers
CREATE POLICY "No direct modifications allowed"
ON public.contact_renumber_audit
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);