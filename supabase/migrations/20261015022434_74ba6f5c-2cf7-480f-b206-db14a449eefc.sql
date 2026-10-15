CREATE UNIQUE INDEX IF NOT EXISTS documents_client_upload_id_uidx
  ON public.documents (tenant_id, (metadata->>'client_upload_id'))
  WHERE metadata ? 'client_upload_id';

CREATE TABLE public.document_record_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  record_type text NOT NULL,
  record_id uuid NOT NULL,
  linked_by uuid NOT NULL DEFAULT auth.uid(),
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, record_type, record_id)
);
GRANT SELECT, INSERT, DELETE ON public.document_record_links TO authenticated;
GRANT ALL ON public.document_record_links TO service_role;
ALTER TABLE public.document_record_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.document_record_link_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE doc_tenant uuid;
BEGIN
  SELECT tenant_id INTO doc_tenant FROM public.documents WHERE id = NEW.document_id;
  IF doc_tenant IS NULL OR doc_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Document belongs to a different company';
  END IF;
  IF NEW.record_type = 'contract' AND NOT EXISTS (
    SELECT 1 FROM public.signature_envelopes WHERE id = NEW.record_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Contract belongs to a different company';
  END IF;
  NEW.linked_by := auth.uid();
  NEW.linked_at := now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.document_record_link_guard() FROM PUBLIC, anon;
CREATE TRIGGER document_record_links_guard BEFORE INSERT ON public.document_record_links
  FOR EACH ROW EXECUTE FUNCTION public.document_record_link_guard();

CREATE POLICY "drl company read" ON public.document_record_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.tenant_id = document_record_links.tenant_id));
CREATE POLICY "drl company link" ON public.document_record_links FOR INSERT TO authenticated
  WITH CHECK (linked_by = auth.uid() AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.tenant_id = document_record_links.tenant_id));
CREATE POLICY "drl own unlink" ON public.document_record_links FOR DELETE TO authenticated
  USING (linked_by = auth.uid());