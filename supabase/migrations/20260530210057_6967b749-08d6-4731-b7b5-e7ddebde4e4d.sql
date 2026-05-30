
ALTER TABLE public.qxo_connections
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS job_account text,
  ADD COLUMN IF NOT EXISTS branch_contact_name text,
  ADD COLUMN IF NOT EXISTS branch_contact_phone text,
  ADD COLUMN IF NOT EXISTS branch_contact_email text,
  ADD COLUMN IF NOT EXISTS template_id text,
  ADD COLUMN IF NOT EXISTS template_name text,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;

ALTER TABLE public.qxo_credentials
  ADD COLUMN IF NOT EXISTS auth_mode text DEFAULT 'session';

NOTIFY pgrst, 'reload schema';
