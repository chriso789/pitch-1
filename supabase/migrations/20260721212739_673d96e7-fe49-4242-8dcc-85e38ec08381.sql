
ALTER TABLE public.invoice_ar_mirror
  ADD COLUMN IF NOT EXISTS invoice_link text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_type text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS allow_online_cc boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_online_ach boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE INDEX IF NOT EXISTS invoice_ar_mirror_project_idx
  ON public.invoice_ar_mirror (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS invoice_ar_mirror_paid_at_idx
  ON public.invoice_ar_mirror (tenant_id, paid_at);

NOTIFY pgrst, 'reload schema';
