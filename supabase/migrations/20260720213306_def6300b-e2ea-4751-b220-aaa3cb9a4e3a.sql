
-- ============================================================
-- Sub-plan F: QuickBooks schema hardening
-- Pre-checks confirmed: all target tables empty, no tenant has
-- >1 active qbo_connections row. Safe to enforce.
-- ============================================================

-- 1. One active connection per tenant
CREATE UNIQUE INDEX IF NOT EXISTS qbo_connections_one_active_per_tenant
  ON public.qbo_connections (tenant_id)
  WHERE is_active = true;

-- 2. Require qbo_connection_id on rows that must be connection-scoped
ALTER TABLE public.qbo_entity_mapping   ALTER COLUMN qbo_connection_id SET NOT NULL;
ALTER TABLE public.job_type_item_map    ALTER COLUMN qbo_connection_id SET NOT NULL;
ALTER TABLE public.qbo_location_map     ALTER COLUMN qbo_connection_id SET NOT NULL;
ALTER TABLE public.qbo_payment_mapping  ALTER COLUMN qbo_connection_id SET NOT NULL;
ALTER TABLE public.tenant_qbo_settings  ALTER COLUMN qbo_connection_id SET NOT NULL;
ALTER TABLE public.invoice_ar_mirror    ALTER COLUMN qbo_connection_id SET NOT NULL;

-- 3. Composite unique constraints matching qbo-worker onConflict keys

-- qbo_entity_mapping: one mapping per (tenant, connection, realm, pitch entity, qbo type)
ALTER TABLE public.qbo_entity_mapping
  DROP CONSTRAINT IF EXISTS qbo_entity_mapping_scope_key;
ALTER TABLE public.qbo_entity_mapping
  ADD CONSTRAINT qbo_entity_mapping_scope_key
  UNIQUE (tenant_id, qbo_connection_id, realm_id, pitch_entity_type, pitch_entity_id, qbo_entity_type);

-- job_type_item_map: one item per job_type_code within a connection
ALTER TABLE public.job_type_item_map
  DROP CONSTRAINT IF EXISTS job_type_item_map_scope_key;
ALTER TABLE public.job_type_item_map
  ADD CONSTRAINT job_type_item_map_scope_key
  UNIQUE (tenant_id, qbo_connection_id, realm_id, job_type_code);

-- qbo_location_map: one row per Pitch location within a connection
ALTER TABLE public.qbo_location_map
  DROP CONSTRAINT IF EXISTS qbo_location_map_scope_key;
ALTER TABLE public.qbo_location_map
  ADD CONSTRAINT qbo_location_map_scope_key
  UNIQUE (tenant_id, qbo_connection_id, realm_id, location_id);

-- qbo_payment_mapping: one row per QBO payment within a connection
ALTER TABLE public.qbo_payment_mapping
  DROP CONSTRAINT IF EXISTS qbo_payment_mapping_scope_key;
ALTER TABLE public.qbo_payment_mapping
  ADD CONSTRAINT qbo_payment_mapping_scope_key
  UNIQUE (tenant_id, qbo_connection_id, realm_id, qbo_payment_id);

-- tenant_qbo_settings: one row per connection
ALTER TABLE public.tenant_qbo_settings
  DROP CONSTRAINT IF EXISTS tenant_qbo_settings_scope_key;
ALTER TABLE public.tenant_qbo_settings
  ADD CONSTRAINT tenant_qbo_settings_scope_key
  UNIQUE (tenant_id, qbo_connection_id, realm_id);

-- invoice_ar_mirror: one row per QBO invoice (NOT per project)
ALTER TABLE public.invoice_ar_mirror
  DROP CONSTRAINT IF EXISTS invoice_ar_mirror_scope_key;
ALTER TABLE public.invoice_ar_mirror
  ADD CONSTRAINT invoice_ar_mirror_scope_key
  UNIQUE (tenant_id, qbo_connection_id, realm_id, qbo_invoice_id);

-- Lookup index on (tenant, project) for project-scoped AR reads
CREATE INDEX IF NOT EXISTS invoice_ar_mirror_tenant_project_idx
  ON public.invoice_ar_mirror (tenant_id, project_id);

-- 4. Retire deprecated mapping table (if it ever existed)
DROP TABLE IF EXISTS public.job_type_qbo_mapping;
