
CREATE TABLE IF NOT EXISTS public.srs_order_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.srs_orders(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  doc_type text NOT NULL DEFAULT 'delivery_photo',
  file_name text,
  mime_type text,
  storage_path text,
  source_url text,
  event_id text,
  captured_at timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_srs_order_documents_order ON public.srs_order_documents(order_id);
CREATE INDEX IF NOT EXISTS idx_srs_order_documents_tenant ON public.srs_order_documents(tenant_id);

ALTER TABLE public.srs_order_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "srs_docs_select_tenant" ON public.srs_order_documents;
CREATE POLICY "srs_docs_select_tenant"
  ON public.srs_order_documents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.srs_orders o
      WHERE o.id = srs_order_documents.order_id
        AND o.tenant_id = srs_order_documents.tenant_id
    )
  );

-- Storage bucket for SRS delivery artifacts
INSERT INTO storage.buckets (id, name, public)
VALUES ('srs-order-documents', 'srs-order-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "srs_docs_storage_read" ON storage.objects;
CREATE POLICY "srs_docs_storage_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'srs-order-documents');
