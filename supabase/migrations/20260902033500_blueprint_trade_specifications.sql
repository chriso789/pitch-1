-- Blueprint trade specification bridge for trade-specific takeoff engines.
-- Additive only. Mirrors blueprint_measurement_objects semantics while retaining
-- source PlanPath provenance and review state.

CREATE TABLE IF NOT EXISTS public.blueprint_trade_specifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id uuid NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  source_document_id uuid REFERENCES public.blueprint_source_documents(id) ON DELETE SET NULL,
  trade_id text NOT NULL,
  spec_key text NOT NULL,
  category text NOT NULL,
  value_text text,
  normalized_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  plan_path_id uuid REFERENCES public.blueprint_plan_paths(id) ON DELETE SET NULL,
  page_number integer,
  review_state text NOT NULL DEFAULT 'pending_review',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bp_trade_spec_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT bp_trade_spec_review_state_chk CHECK (review_state IN ('pending_review','confirmed','dismissed','blocked')),
  UNIQUE (import_session_id, source_document_id, trade_id, spec_key, page_number, value_text)
);

CREATE INDEX IF NOT EXISTS idx_bp_trade_specs_session ON public.blueprint_trade_specifications(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_trade_specs_trade ON public.blueprint_trade_specifications(trade_id);
CREATE INDEX IF NOT EXISTS idx_bp_trade_specs_key ON public.blueprint_trade_specifications(spec_key);

ALTER TABLE public.blueprint_trade_specifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blueprint_trade_specifications tenant all" ON public.blueprint_trade_specifications;
CREATE POLICY "blueprint_trade_specifications tenant all" ON public.blueprint_trade_specifications
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP TRIGGER IF EXISTS blueprint_trade_specifications_touch ON public.blueprint_trade_specifications;
CREATE TRIGGER blueprint_trade_specifications_touch
  BEFORE UPDATE ON public.blueprint_trade_specifications
  FOR EACH ROW EXECUTE FUNCTION public.plan_touch_updated_at();

NOTIFY pgrst, 'reload schema';
