CREATE TABLE public.pdf_batch_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 10),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.pdf_batch_templates TO authenticated;
GRANT ALL ON public.pdf_batch_templates TO service_role;
ALTER TABLE public.pdf_batch_templates ENABLE ROW LEVEL SECURITY;
CREATE INDEX pdf_batch_templates_tenant_idx ON public.pdf_batch_templates(tenant_id, created_at DESC);
CREATE POLICY "company members read batch templates" ON public.pdf_batch_templates FOR SELECT TO authenticated USING (public.pdf_compare_member(tenant_id));
CREATE POLICY "company members add batch templates" ON public.pdf_batch_templates FOR INSERT TO authenticated WITH CHECK (public.pdf_compare_member(tenant_id) AND created_by = auth.uid());
CREATE POLICY "creator deletes own batch templates" ON public.pdf_batch_templates FOR DELETE TO authenticated USING (public.pdf_compare_member(tenant_id) AND created_by = auth.uid());