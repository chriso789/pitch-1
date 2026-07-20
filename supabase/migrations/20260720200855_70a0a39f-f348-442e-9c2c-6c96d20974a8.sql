
-- ============================================================
-- QBO Sub-plan A: schema foundation for production cutover
-- ============================================================

-- 1) Extend qbo_entity_mapping so one Pitch entity can carry
--    multiple QBO entity mappings (Customer, Project, SubCustomerJob,
--    Invoice, Payment) without collision.
ALTER TABLE public.qbo_entity_mapping
  ADD COLUMN IF NOT EXISTS pitch_entity_type text,
  ADD COLUMN IF NOT EXISTS pitch_entity_id uuid,
  ADD COLUMN IF NOT EXISTS pitch_project_number text,
  ADD COLUMN IF NOT EXISTS qbo_doc_number text,
  ADD COLUMN IF NOT EXISTS sync_token text,
  ADD COLUMN IF NOT EXISTS mapping_mode text;

-- Backfill new columns from legacy pair (table is currently empty in prod, safe either way)
UPDATE public.qbo_entity_mapping
   SET pitch_entity_type = COALESCE(pitch_entity_type, entity_type),
       pitch_entity_id   = COALESCE(pitch_entity_id, entity_id)
 WHERE pitch_entity_type IS NULL OR pitch_entity_id IS NULL;

-- Drop old collapsing unique constraint, install correct one that
-- allows multiple qbo_entity_type rows per Pitch entity.
ALTER TABLE public.qbo_entity_mapping
  DROP CONSTRAINT IF EXISTS qbo_entity_mapping_tenant_id_entity_type_entity_id_realm_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS qbo_entity_mapping_pitch_qbo_uniq
  ON public.qbo_entity_mapping (tenant_id, realm_id, pitch_entity_type, pitch_entity_id, qbo_entity_type);

CREATE INDEX IF NOT EXISTS idx_qbo_entity_mapping_pitch
  ON public.qbo_entity_mapping (tenant_id, pitch_entity_type, pitch_entity_id);


-- 2) Tenant QBO settings (per tenant × realm)
CREATE TABLE IF NOT EXISTS public.tenant_qbo_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  realm_id text NOT NULL,
  project_mapping_mode text NOT NULL DEFAULT 'auto'
    CHECK (project_mapping_mode IN ('auto','native_project','sub_customer_job')),
  invoice_numbering_mode text NOT NULL DEFAULT 'qbo_managed'
    CHECK (invoice_numbering_mode IN ('qbo_managed','pitch_managed')),
  customer_visible_project_number boolean NOT NULL DEFAULT false,
  default_income_account_id text,
  default_item_id text,
  default_tax_code_id text,
  default_department_id text,
  default_class_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, realm_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_qbo_settings TO authenticated;
GRANT ALL ON public.tenant_qbo_settings TO service_role;

ALTER TABLE public.tenant_qbo_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_qbo_settings_select ON public.tenant_qbo_settings;
CREATE POLICY tenant_qbo_settings_select
  ON public.tenant_qbo_settings FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS tenant_qbo_settings_write ON public.tenant_qbo_settings;
CREATE POLICY tenant_qbo_settings_write
  ON public.tenant_qbo_settings FOR ALL
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.tenant_qbo_settings_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_tenant_qbo_settings_touch ON public.tenant_qbo_settings;
CREATE TRIGGER trg_tenant_qbo_settings_touch
  BEFORE UPDATE ON public.tenant_qbo_settings
  FOR EACH ROW EXECUTE FUNCTION public.tenant_qbo_settings_touch();


-- 3) Extend invoice_ar_mirror to hold real Pitch↔QBO invoice link + AR fields
ALTER TABLE public.invoice_ar_mirror
  ADD COLUMN IF NOT EXISTS pitch_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS sync_token text,
  ADD COLUMN IF NOT EXISTS tax_amount numeric,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric,
  ADD COLUMN IF NOT EXISTS email_status text,
  ADD COLUMN IF NOT EXISTS txn_date date,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS realm_id text;

CREATE INDEX IF NOT EXISTS idx_invoice_ar_mirror_pitch_invoice
  ON public.invoice_ar_mirror (tenant_id, pitch_invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_ar_mirror_realm_qbo
  ON public.invoice_ar_mirror (tenant_id, realm_id, qbo_invoice_id);


-- 4) Dedicated QBO Payment ledger (kept separate from crew payouts / AP)
CREATE TABLE IF NOT EXISTS public.qbo_payment_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  realm_id text NOT NULL,
  pitch_payment_id uuid,
  pitch_invoice_id uuid,
  qbo_payment_id text NOT NULL,
  qbo_customer_id text,
  qbo_invoice_id text,
  total_amount numeric,
  unapplied_amount numeric,
  txn_date date,
  sync_token text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, realm_id, qbo_payment_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_payment_mapping TO authenticated;
GRANT ALL ON public.qbo_payment_mapping TO service_role;

ALTER TABLE public.qbo_payment_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qbo_payment_mapping_select ON public.qbo_payment_mapping;
CREATE POLICY qbo_payment_mapping_select
  ON public.qbo_payment_mapping FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS qbo_payment_mapping_write ON public.qbo_payment_mapping;
CREATE POLICY qbo_payment_mapping_write
  ON public.qbo_payment_mapping FOR ALL
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.qbo_payment_mapping_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_qbo_payment_mapping_touch ON public.qbo_payment_mapping;
CREATE TRIGGER trg_qbo_payment_mapping_touch
  BEFORE UPDATE ON public.qbo_payment_mapping
  FOR EACH ROW EXECUTE FUNCTION public.qbo_payment_mapping_touch();


-- Refresh PostgREST schema cache so the new columns/tables are visible immediately.
NOTIFY pgrst, 'reload schema';
