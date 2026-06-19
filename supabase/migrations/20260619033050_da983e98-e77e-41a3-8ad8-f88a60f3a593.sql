
CREATE TABLE IF NOT EXISTS public.ai_document_apply_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  extraction_id uuid NOT NULL REFERENCES public.ai_document_extractions(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  field_name text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  apply_status text NOT NULL DEFAULT 'pending'
    CHECK (apply_status IN ('pending','applied','skipped','rejected','conflict','failed')),
  apply_reason text,
  confidence numeric,
  action text,
  applied_by uuid,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_document_apply_events TO authenticated;
GRANT ALL ON public.ai_document_apply_events TO service_role;

ALTER TABLE public.ai_document_apply_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_adae_tenant ON public.ai_document_apply_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_adae_extraction ON public.ai_document_apply_events(extraction_id);
CREATE INDEX IF NOT EXISTS idx_adae_document ON public.ai_document_apply_events(document_id);
CREATE INDEX IF NOT EXISTS idx_adae_target ON public.ai_document_apply_events(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_adae_status ON public.ai_document_apply_events(apply_status);

CREATE POLICY "apply_events_tenant_select"
  ON public.ai_document_apply_events
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "apply_events_tenant_insert"
  ON public.ai_document_apply_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "apply_events_tenant_update"
  ON public.ai_document_apply_events
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );
