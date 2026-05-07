
CREATE TABLE IF NOT EXISTS public.pdf_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  pdf_document_id UUID,
  actor_id UUID,
  event_type TEXT NOT NULL,
  event_payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.pdf_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant audit events"
  ON public.pdf_audit_events
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can create audit events for their tenant"
  ON public.pdf_audit_events
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()
  ));

CREATE INDEX idx_pdf_audit_events_tenant ON public.pdf_audit_events(tenant_id, created_at DESC);
CREATE INDEX idx_pdf_audit_events_document ON public.pdf_audit_events(pdf_document_id, created_at DESC);
