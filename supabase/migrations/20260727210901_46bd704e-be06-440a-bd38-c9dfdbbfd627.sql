-- P0 supplier catalog/mapping persistence hardening

-- 1) Expand mapping status without dropping existing enum values.
ALTER TYPE public.supplier_mapping_status ADD VALUE IF NOT EXISTS 'revalidation_required';
ALTER TYPE public.supplier_mapping_status ADD VALUE IF NOT EXISTS 'stale';
ALTER TYPE public.supplier_mapping_status ADD VALUE IF NOT EXISTS 'inactive_supplier_item';
ALTER TYPE public.supplier_mapping_status ADD VALUE IF NOT EXISTS 'catalog_conflict';

-- 2) Durable sync-run log. Failed/partial/zero runs are evidence only and must not
-- erase last-known-good supplier catalog rows.
CREATE TABLE IF NOT EXISTS public.supplier_catalog_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplier public.supplier_kind NOT NULL,
  supplier_connection_id uuid,
  environment text NOT NULL DEFAULT 'sandbox',
  branch_code text,
  ship_to_number text,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  items_seen integer NOT NULL DEFAULT 0,
  items_upserted integer NOT NULL DEFAULT 0,
  items_marked_inactive integer NOT NULL DEFAULT 0,
  mappings_created integer NOT NULL DEFAULT 0,
  mappings_updated integer NOT NULL DEFAULT 0,
  fingerprint text,
  error_code text,
  error_message text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_catalog_sync_runs_status_chk CHECK (status IN ('running','completed','failed','timeout','partial','unauthorized','zero_result_blocked'))
);

GRANT SELECT ON public.supplier_catalog_sync_runs TO authenticated;
GRANT ALL ON public.supplier_catalog_sync_runs TO service_role;
ALTER TABLE public.supplier_catalog_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant members read supplier catalog sync runs" ON public.supplier_catalog_sync_runs;
CREATE POLICY "Tenant members read supplier catalog sync runs"
  ON public.supplier_catalog_sync_runs
  FOR SELECT
  TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_sync_runs_scope
  ON public.supplier_catalog_sync_runs (tenant_id, supplier, environment, branch_code, started_at DESC);

DROP TRIGGER IF EXISTS trg_supplier_catalog_sync_runs_updated_at ON public.supplier_catalog_sync_runs;
CREATE TRIGGER trg_supplier_catalog_sync_runs_updated_at
  BEFORE UPDATE ON public.supplier_catalog_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

-- 3) Supplier audit helper table for durable recovery and blocked-destructive-operation evidence.
CREATE TABLE IF NOT EXISTS public.supplier_catalog_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplier public.supplier_kind,
  event_type text NOT NULL,
  entity_table text NOT NULL,
  entity_id uuid,
  supplier_connection_id uuid,
  environment text,
  branch_code text,
  actor_user_id uuid,
  reason text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.supplier_catalog_audit_events TO authenticated;
GRANT ALL ON public.supplier_catalog_audit_events TO service_role;
ALTER TABLE public.supplier_catalog_audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant members read supplier catalog audit events" ON public.supplier_catalog_audit_events;
CREATE POLICY "Tenant members read supplier catalog audit events"
  ON public.supplier_catalog_audit_events
  FOR SELECT
  TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids(auth.uid())));

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_audit_events_scope
  ON public.supplier_catalog_audit_events (tenant_id, supplier, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_audit_events_entity
  ON public.supplier_catalog_audit_events (entity_table, entity_id, created_at DESC);

-- 4) Make mapping revision history durable. Revisions must not disappear just
-- because a mapping is accidentally deleted; the delete should be blocked.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_item_mapping_revisions_mapping_id_fkey'
      AND conrelid = 'public.supplier_item_mapping_revisions'::regclass
  ) THEN
    ALTER TABLE public.supplier_item_mapping_revisions
      DROP CONSTRAINT supplier_item_mapping_revisions_mapping_id_fkey;
  END IF;
END $$;

ALTER TABLE public.supplier_item_mapping_revisions
  ADD CONSTRAINT supplier_item_mapping_revisions_mapping_id_fkey
  FOREIGN KEY (mapping_id)
  REFERENCES public.supplier_item_mappings(id)
  ON DELETE RESTRICT;

-- 5) Database-level guardrails: no normal path may materially delete supplier
-- catalogs/mappings or wipe canonical identity once data exists. A privileged
-- maintenance migration/session must explicitly set app.allow_supplier_destructive=true.
CREATE OR REPLACE FUNCTION public.block_supplier_destructive_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allow_delete text;
  affected_tenant uuid;
  entity uuid;
BEGIN
  allow_delete := current_setting('app.allow_supplier_destructive', true);
  IF allow_delete = 'true' THEN
    RETURN OLD;
  END IF;

  affected_tenant := OLD.tenant_id;
  entity := OLD.id;

  INSERT INTO public.supplier_catalog_audit_events
    (tenant_id, supplier, event_type, entity_table, entity_id, supplier_connection_id, environment, branch_code, actor_user_id, reason, before_state)
  VALUES
    (
      affected_tenant,
      CASE WHEN TG_TABLE_NAME = 'supplier_item_mappings' THEN OLD.supplier ELSE NULL END,
      'destructive_delete_blocked',
      TG_TABLE_NAME,
      entity,
      CASE WHEN TG_TABLE_NAME IN ('supplier_item_mappings','abc_catalog_items') THEN OLD.supplier_connection_id ELSE NULL END,
      CASE WHEN TG_TABLE_NAME = 'abc_catalog_items' THEN OLD.environment ELSE NULL END,
      CASE WHEN TG_TABLE_NAME = 'supplier_item_mappings' THEN OLD.branch_code WHEN TG_TABLE_NAME = 'abc_catalog_items' THEN OLD.branch_number ELSE NULL END,
      auth.uid(),
      'Supplier catalog and mapping records are durable. Archive/mark inactive instead of deleting.',
      to_jsonb(OLD)
    );

  RAISE EXCEPTION 'Supplier catalog/mapping deletes are blocked; archive or mark inactive instead.' USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS block_delete_abc_catalog_items ON public.abc_catalog_items;
CREATE TRIGGER block_delete_abc_catalog_items
  BEFORE DELETE ON public.abc_catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.block_supplier_destructive_delete();

DROP TRIGGER IF EXISTS block_delete_supplier_item_mappings ON public.supplier_item_mappings;
CREATE TRIGGER block_delete_supplier_item_mappings
  BEFORE DELETE ON public.supplier_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.block_supplier_destructive_delete();

DROP TRIGGER IF EXISTS block_delete_mfr_manufacturers ON public.mfr_manufacturers;
CREATE TRIGGER block_delete_mfr_manufacturers
  BEFORE DELETE ON public.mfr_manufacturers
  FOR EACH ROW EXECUTE FUNCTION public.block_supplier_destructive_delete();

DROP TRIGGER IF EXISTS block_delete_mfr_product_lines ON public.mfr_product_lines;
CREATE TRIGGER block_delete_mfr_product_lines
  BEFORE DELETE ON public.mfr_product_lines
  FOR EACH ROW EXECUTE FUNCTION public.block_supplier_destructive_delete();

DROP TRIGGER IF EXISTS block_delete_mfr_colors ON public.mfr_colors;
CREATE TRIGGER block_delete_mfr_colors
  BEFORE DELETE ON public.mfr_colors
  FOR EACH ROW EXECUTE FUNCTION public.block_supplier_destructive_delete();

DROP TRIGGER IF EXISTS block_delete_mfr_product_variants ON public.mfr_product_variants;
CREATE TRIGGER block_delete_mfr_product_variants
  BEFORE DELETE ON public.mfr_product_variants
  FOR EACH ROW EXECUTE FUNCTION public.block_supplier_destructive_delete();

-- 6) Audit durable supplier mapping changes with specific event names while keeping
-- the existing revision trigger as the detailed before/after history.
CREATE OR REPLACE FUNCTION public.audit_supplier_item_mapping_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := CASE WHEN NEW.approval_state = 'pending' THEN 'mapping_proposed' ELSE 'mapping_created' END;
    INSERT INTO public.supplier_catalog_audit_events
      (tenant_id, supplier, event_type, entity_table, entity_id, supplier_connection_id, branch_code, actor_user_id, after_state)
    VALUES
      (NEW.tenant_id, NEW.supplier, event_name, TG_TABLE_NAME, NEW.id, NEW.supplier_connection_id, NEW.branch_code, auth.uid(), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF NEW.approval_state IS DISTINCT FROM OLD.approval_state THEN
    event_name := CASE NEW.approval_state
      WHEN 'approved' THEN 'mapping_approved'
      WHEN 'rejected' THEN 'mapping_rejected'
      ELSE 'mapping_revalidation_required'
    END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    event_name := CASE NEW.status
      WHEN 'superseded' THEN 'mapping_superseded'
      WHEN 'revalidation_required' THEN 'mapping_revalidation_required'
      WHEN 'stale' THEN 'mapping_stale'
      WHEN 'inactive_supplier_item' THEN 'mapping_inactive_supplier_item'
      WHEN 'catalog_conflict' THEN 'mapping_catalog_conflict'
      ELSE 'mapping_status_changed'
    END;
  ELSIF NEW.catalog_fingerprint IS DISTINCT FROM OLD.catalog_fingerprint THEN
    event_name := 'mapping_catalog_evidence_updated';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.supplier_catalog_audit_events
    (tenant_id, supplier, event_type, entity_table, entity_id, supplier_connection_id, branch_code, actor_user_id, reason, before_state, after_state)
  VALUES
    (NEW.tenant_id, NEW.supplier, event_name, TG_TABLE_NAME, NEW.id, NEW.supplier_connection_id, NEW.branch_code, auth.uid(), NEW.notes, to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_supplier_item_mapping_ins ON public.supplier_item_mappings;
CREATE TRIGGER audit_supplier_item_mapping_ins
  AFTER INSERT ON public.supplier_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.audit_supplier_item_mapping_change();

DROP TRIGGER IF EXISTS audit_supplier_item_mapping_upd ON public.supplier_item_mappings;
CREATE TRIGGER audit_supplier_item_mapping_upd
  AFTER UPDATE ON public.supplier_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.audit_supplier_item_mapping_change();

-- 7) Catalog item audit. Updates are intentionally scoped to fingerprint/status
-- changes to avoid noisy audit rows for every sync timestamp touch.
CREATE OR REPLACE FUNCTION public.audit_abc_catalog_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.supplier_catalog_audit_events
      (tenant_id, supplier, event_type, entity_table, entity_id, supplier_connection_id, environment, branch_code, actor_user_id, after_state)
    VALUES
      (NEW.tenant_id, 'abc', 'catalog_item_created', TG_TABLE_NAME, NEW.id, NEW.connection_id, NEW.environment, NEW.branch_number, auth.uid(), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NEW.is_active = false THEN
    event_name := 'catalog_item_marked_inactive';
  ELSIF NEW.raw_fingerprint IS DISTINCT FROM OLD.raw_fingerprint THEN
    event_name := 'catalog_item_updated';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.supplier_catalog_audit_events
    (tenant_id, supplier, event_type, entity_table, entity_id, supplier_connection_id, environment, branch_code, actor_user_id, before_state, after_state)
  VALUES
    (NEW.tenant_id, 'abc', event_name, TG_TABLE_NAME, NEW.id, NEW.connection_id, NEW.environment, NEW.branch_number, auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_abc_catalog_item_ins ON public.abc_catalog_items;
CREATE TRIGGER audit_abc_catalog_item_ins
  AFTER INSERT ON public.abc_catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_abc_catalog_item_change();

DROP TRIGGER IF EXISTS audit_abc_catalog_item_upd ON public.abc_catalog_items;
CREATE TRIGGER audit_abc_catalog_item_upd
  AFTER UPDATE ON public.abc_catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_abc_catalog_item_change();

-- 8) Recovery/diagnostic indexes.
CREATE INDEX IF NOT EXISTS idx_abc_catalog_items_scope_branch_item
  ON public.abc_catalog_items (tenant_id, environment, branch_number, item_number);
CREATE INDEX IF NOT EXISTS idx_supplier_item_mappings_connection_recovery
  ON public.supplier_item_mappings (tenant_id, supplier, supplier_connection_id, branch_code, approval_state, status);

-- RLS impact: new tables are tenant-readable only. Existing policies remain tenant-scoped.
NOTIFY pgrst, 'reload schema';