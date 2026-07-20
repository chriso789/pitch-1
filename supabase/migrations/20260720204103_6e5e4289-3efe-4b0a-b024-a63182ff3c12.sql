
-- =========================================================================
-- Sub-plan F: QuickBooks schema hardening
-- Pre-flight (already verified): no duplicate active qbo_connections per tenant;
-- all mapping tables empty; job_type_qbo_mapping does not exist.
-- =========================================================================

-- 1. One active QBO connection per tenant
CREATE UNIQUE INDEX IF NOT EXISTS qbo_connections_one_active_per_tenant
  ON public.qbo_connections (tenant_id)
  WHERE is_active = true;

-- 2. Add qbo_connection_id to every mapping/settings/mirror table
ALTER TABLE public.qbo_entity_mapping   ADD COLUMN IF NOT EXISTS qbo_connection_id uuid REFERENCES public.qbo_connections(id) ON DELETE RESTRICT;
ALTER TABLE public.job_type_item_map    ADD COLUMN IF NOT EXISTS qbo_connection_id uuid REFERENCES public.qbo_connections(id) ON DELETE RESTRICT;
ALTER TABLE public.qbo_location_map     ADD COLUMN IF NOT EXISTS qbo_connection_id uuid REFERENCES public.qbo_connections(id) ON DELETE RESTRICT;
ALTER TABLE public.invoice_ar_mirror    ADD COLUMN IF NOT EXISTS qbo_connection_id uuid REFERENCES public.qbo_connections(id) ON DELETE RESTRICT;
ALTER TABLE public.qbo_payment_mapping  ADD COLUMN IF NOT EXISTS qbo_connection_id uuid REFERENCES public.qbo_connections(id) ON DELETE RESTRICT;
ALTER TABLE public.tenant_qbo_settings  ADD COLUMN IF NOT EXISTS qbo_connection_id uuid REFERENCES public.qbo_connections(id) ON DELETE RESTRICT;

-- 3. Backfill qbo_connection_id from (tenant_id, realm_id). All tables empty
--    per pre-flight, but the joins are safe if rows appear before the migration runs.
--    Exception report: skipped rows land in a temp table for audit.
DO $$
DECLARE
  affected int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _qbo_backfill_exceptions (
    table_name text, row_id uuid, tenant_id uuid, realm_id text, match_count int
  ) ON COMMIT DROP;

  -- Helper CTE per table
  WITH matches AS (
    SELECT m.id, m.tenant_id, m.realm_id, count(c.id) AS n, min(c.id::text)::uuid AS one_id
    FROM public.qbo_entity_mapping m
    LEFT JOIN public.qbo_connections c
      ON c.tenant_id = m.tenant_id AND c.realm_id = m.realm_id
    WHERE m.qbo_connection_id IS NULL
    GROUP BY m.id, m.tenant_id, m.realm_id
  )
  UPDATE public.qbo_entity_mapping m SET qbo_connection_id = mt.one_id
  FROM matches mt WHERE mt.id = m.id AND mt.n = 1;

  INSERT INTO _qbo_backfill_exceptions
  SELECT 'qbo_entity_mapping', m.id, m.tenant_id, m.realm_id,
    (SELECT count(*) FROM public.qbo_connections c WHERE c.tenant_id=m.tenant_id AND c.realm_id=m.realm_id)
  FROM public.qbo_entity_mapping m WHERE m.qbo_connection_id IS NULL;

  WITH matches AS (
    SELECT m.id, count(c.id) AS n, min(c.id::text)::uuid AS one_id
    FROM public.job_type_item_map m
    LEFT JOIN public.qbo_connections c ON c.tenant_id=m.tenant_id AND c.realm_id=m.realm_id
    WHERE m.qbo_connection_id IS NULL GROUP BY m.id
  )
  UPDATE public.job_type_item_map m SET qbo_connection_id = mt.one_id
  FROM matches mt WHERE mt.id = m.id AND mt.n = 1;

  WITH matches AS (
    SELECT m.id, count(c.id) AS n, min(c.id::text)::uuid AS one_id
    FROM public.qbo_location_map m
    LEFT JOIN public.qbo_connections c ON c.tenant_id=m.tenant_id AND c.realm_id=m.realm_id
    WHERE m.qbo_connection_id IS NULL GROUP BY m.id
  )
  UPDATE public.qbo_location_map m SET qbo_connection_id = mt.one_id
  FROM matches mt WHERE mt.id = m.id AND mt.n = 1;

  WITH matches AS (
    SELECT m.id, count(c.id) AS n, min(c.id::text)::uuid AS one_id
    FROM public.invoice_ar_mirror m
    LEFT JOIN public.qbo_connections c ON c.tenant_id=m.tenant_id AND c.realm_id=m.realm_id
    WHERE m.qbo_connection_id IS NULL AND m.realm_id IS NOT NULL GROUP BY m.id
  )
  UPDATE public.invoice_ar_mirror m SET qbo_connection_id = mt.one_id
  FROM matches mt WHERE mt.id = m.id AND mt.n = 1;

  WITH matches AS (
    SELECT m.id, count(c.id) AS n, min(c.id::text)::uuid AS one_id
    FROM public.qbo_payment_mapping m
    LEFT JOIN public.qbo_connections c ON c.tenant_id=m.tenant_id AND c.realm_id=m.realm_id
    WHERE m.qbo_connection_id IS NULL GROUP BY m.id
  )
  UPDATE public.qbo_payment_mapping m SET qbo_connection_id = mt.one_id
  FROM matches mt WHERE mt.id = m.id AND mt.n = 1;

  WITH matches AS (
    SELECT m.id, count(c.id) AS n, min(c.id::text)::uuid AS one_id
    FROM public.tenant_qbo_settings m
    LEFT JOIN public.qbo_connections c ON c.tenant_id=m.tenant_id AND c.realm_id=m.realm_id
    WHERE m.qbo_connection_id IS NULL GROUP BY m.id
  )
  UPDATE public.tenant_qbo_settings m SET qbo_connection_id = mt.one_id
  FROM matches mt WHERE mt.id = m.id AND mt.n = 1;

  SELECT count(*) INTO affected FROM _qbo_backfill_exceptions;
  IF affected > 0 THEN
    RAISE NOTICE 'qbo backfill exceptions: % rows could not be uniquely mapped', affected;
  END IF;
END$$;

-- 4. Drop old uniqueness / indexes that scope by (tenant_id, realm_id, ...) only,
--    then add connection-scoped uniqueness. Uses IF EXISTS so re-runs are safe.

-- qbo_entity_mapping
ALTER TABLE public.qbo_entity_mapping
  DROP CONSTRAINT IF EXISTS qbo_entity_mapping_tenant_id_local_entity_type_local_entit_key,
  DROP CONSTRAINT IF EXISTS qbo_entity_mapping_tenant_id_realm_id_pitch_entity_type_pit_key,
  DROP CONSTRAINT IF EXISTS qbo_entity_mapping_unique_pitch,
  DROP CONSTRAINT IF EXISTS qbo_entity_mapping_unique;
DROP INDEX IF EXISTS public.qbo_entity_mapping_unique_pitch_idx;

CREATE UNIQUE INDEX IF NOT EXISTS qbo_entity_mapping_unique
  ON public.qbo_entity_mapping (
    tenant_id, qbo_connection_id, realm_id,
    pitch_entity_type, pitch_entity_id, qbo_entity_type
  )
  WHERE pitch_entity_type IS NOT NULL AND pitch_entity_id IS NOT NULL;

-- job_type_item_map
ALTER TABLE public.job_type_item_map
  DROP CONSTRAINT IF EXISTS job_type_item_map_tenant_id_realm_id_job_type_code_key,
  DROP CONSTRAINT IF EXISTS job_type_item_map_unique;
CREATE UNIQUE INDEX IF NOT EXISTS job_type_item_map_unique
  ON public.job_type_item_map (tenant_id, qbo_connection_id, realm_id, job_type_code);

-- qbo_location_map
ALTER TABLE public.qbo_location_map
  DROP CONSTRAINT IF EXISTS qbo_location_map_tenant_id_realm_id_location_id_key,
  DROP CONSTRAINT IF EXISTS qbo_location_map_unique;
CREATE UNIQUE INDEX IF NOT EXISTS qbo_location_map_unique
  ON public.qbo_location_map (tenant_id, qbo_connection_id, realm_id, location_id);

-- invoice_ar_mirror — become invoice-scoped, not project-scoped
ALTER TABLE public.invoice_ar_mirror
  DROP CONSTRAINT IF EXISTS invoice_ar_mirror_tenant_id_project_id_key,
  DROP CONSTRAINT IF EXISTS invoice_ar_mirror_project_unique,
  DROP CONSTRAINT IF EXISTS invoice_ar_mirror_unique;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_ar_mirror_unique_invoice
  ON public.invoice_ar_mirror (tenant_id, qbo_connection_id, realm_id, qbo_invoice_id);
CREATE INDEX IF NOT EXISTS invoice_ar_mirror_project_idx
  ON public.invoice_ar_mirror (tenant_id, project_id);

-- qbo_payment_mapping
ALTER TABLE public.qbo_payment_mapping
  DROP CONSTRAINT IF EXISTS qbo_payment_mapping_tenant_id_realm_id_qbo_payment_id_key,
  DROP CONSTRAINT IF EXISTS qbo_payment_mapping_unique;
CREATE UNIQUE INDEX IF NOT EXISTS qbo_payment_mapping_unique
  ON public.qbo_payment_mapping (tenant_id, qbo_connection_id, realm_id, qbo_payment_id);

-- tenant_qbo_settings
ALTER TABLE public.tenant_qbo_settings
  DROP CONSTRAINT IF EXISTS tenant_qbo_settings_tenant_id_realm_id_key,
  DROP CONSTRAINT IF EXISTS tenant_qbo_settings_unique;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_qbo_settings_unique
  ON public.tenant_qbo_settings (tenant_id, qbo_connection_id, realm_id);

-- 5. Helper index for connection-scoped reads
CREATE INDEX IF NOT EXISTS qbo_entity_mapping_conn_idx ON public.qbo_entity_mapping (qbo_connection_id);
CREATE INDEX IF NOT EXISTS job_type_item_map_conn_idx  ON public.job_type_item_map  (qbo_connection_id);
CREATE INDEX IF NOT EXISTS qbo_location_map_conn_idx   ON public.qbo_location_map   (qbo_connection_id);
CREATE INDEX IF NOT EXISTS invoice_ar_mirror_conn_idx  ON public.invoice_ar_mirror  (qbo_connection_id);
CREATE INDEX IF NOT EXISTS qbo_payment_mapping_conn_idx ON public.qbo_payment_mapping (qbo_connection_id);
CREATE INDEX IF NOT EXISTS tenant_qbo_settings_conn_idx ON public.tenant_qbo_settings (qbo_connection_id);
