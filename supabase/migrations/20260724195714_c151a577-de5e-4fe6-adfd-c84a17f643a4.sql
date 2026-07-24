-- =====================================================================
-- Slice 3 — QuickBooks Project Mapping foundation (retry with correct RLS helper)
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'accounting_readiness_state' AND e.enumlabel = 'qbo_sync_queued') THEN
    ALTER TYPE public.accounting_readiness_state ADD VALUE 'qbo_sync_queued';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'accounting_readiness_state' AND e.enumlabel = 'qbo_sync_in_progress') THEN
    ALTER TYPE public.accounting_readiness_state ADD VALUE 'qbo_sync_in_progress';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'accounting_readiness_state' AND e.enumlabel = 'qbo_duplicate_review_required') THEN
    ALTER TYPE public.accounting_readiness_state ADD VALUE 'qbo_duplicate_review_required';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.project_qbo_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  qbo_connection_id UUID NOT NULL REFERENCES public.qbo_connections(id) ON DELETE CASCADE,
  pitch_project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  pitch_contact_id UUID,
  representation_strategy TEXT NOT NULL DEFAULT 'project_as_customer'
    CHECK (representation_strategy IN ('project_as_customer', 'contact_customer_with_sub', 'qbo_project')),
  qbo_customer_id TEXT,
  qbo_subcustomer_id TEXT,
  qbo_project_id TEXT,
  qbo_display_name TEXT,
  qbo_sync_token TEXT,
  sync_status TEXT NOT NULL DEFAULT 'not_created'
    CHECK (sync_status IN ('not_created','queued','creating','ready','sync_error','duplicate_review_required','archived')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  last_intuit_tid TEXT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_qbo_mappings_active
  ON public.project_qbo_mappings (tenant_id, qbo_connection_id, pitch_project_id)
  WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_project_qbo_mappings_project
  ON public.project_qbo_mappings (pitch_project_id);
CREATE INDEX IF NOT EXISTS idx_project_qbo_mappings_tenant
  ON public.project_qbo_mappings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_qbo_mappings_customer
  ON public.project_qbo_mappings (qbo_connection_id, qbo_customer_id)
  WHERE qbo_customer_id IS NOT NULL;

GRANT SELECT ON public.project_qbo_mappings TO authenticated;
GRANT ALL    ON public.project_qbo_mappings TO service_role;

ALTER TABLE public.project_qbo_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_qbo_mappings_tenant_read" ON public.project_qbo_mappings;
CREATE POLICY "project_qbo_mappings_tenant_read"
  ON public.project_qbo_mappings
  FOR SELECT
  TO authenticated
  USING (public.user_can_access_tenant(tenant_id));

DROP TRIGGER IF EXISTS trg_project_qbo_mappings_updated_at ON public.project_qbo_mappings;
CREATE TRIGGER trg_project_qbo_mappings_updated_at
  BEFORE UPDATE ON public.project_qbo_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
