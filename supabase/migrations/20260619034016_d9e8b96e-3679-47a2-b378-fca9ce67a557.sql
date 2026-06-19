
-- Add match and workflow metadata to extractions
ALTER TABLE public.ai_document_extractions
  ADD COLUMN IF NOT EXISTS match_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Workflow event audit table
CREATE TABLE IF NOT EXISTS public.ai_document_workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  extraction_id uuid NOT NULL REFERENCES public.ai_document_extractions(id) ON DELETE CASCADE,
  document_id uuid,
  workflow_type text NOT NULL,
  action_key text NOT NULL,
  target_table text,
  target_id uuid,
  status text NOT NULL DEFAULT 'pending',
  old_value jsonb,
  new_value jsonb,
  reason text,
  executed_by uuid,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.ai_document_workflow_events TO authenticated;
GRANT ALL ON public.ai_document_workflow_events TO service_role;

ALTER TABLE public.ai_document_workflow_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant can read own workflow events"
  ON public.ai_document_workflow_events FOR SELECT TO authenticated
  USING (
    tenant_id = COALESCE(
      (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid()),
      (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    )
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "tenant can insert own workflow events"
  ON public.ai_document_workflow_events FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = COALESCE(
      (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid()),
      (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    )
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE INDEX IF NOT EXISTS ai_doc_workflow_events_extraction_idx
  ON public.ai_document_workflow_events (extraction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_doc_workflow_events_tenant_idx
  ON public.ai_document_workflow_events (tenant_id, created_at DESC);
