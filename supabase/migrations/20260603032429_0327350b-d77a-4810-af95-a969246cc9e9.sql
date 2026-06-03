CREATE TABLE IF NOT EXISTS public.contact_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  namespace TEXT GENERATED ALWAYS AS (split_part(tag, ':', 1)) STORED,
  source TEXT,
  source_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_by UUID,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_tags_tag_format_chk CHECK (tag ~ '^[a-z][a-z0-9_]*:[a-z0-9][a-z0-9_\-]*$')
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_tags_active_uniq
  ON public.contact_tags (tenant_id, contact_id, tag)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS contact_tags_tenant_contact_idx
  ON public.contact_tags (tenant_id, contact_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS contact_tags_tenant_tag_idx
  ON public.contact_tags (tenant_id, tag) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS contact_tags_tenant_namespace_idx
  ON public.contact_tags (tenant_id, namespace) WHERE removed_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_tags TO authenticated;
GRANT ALL ON public.contact_tags TO service_role;

ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_tags_tenant_select"
  ON public.contact_tags
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.has_role(auth.uid(), 'master'::public.app_role));

CREATE POLICY "contact_tags_tenant_insert"
  ON public.contact_tags
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.has_role(auth.uid(), 'master'::public.app_role));

CREATE POLICY "contact_tags_tenant_update"
  ON public.contact_tags
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.has_role(auth.uid(), 'master'::public.app_role))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.has_role(auth.uid(), 'master'::public.app_role));

CREATE POLICY "contact_tags_tenant_delete"
  ON public.contact_tags
  FOR DELETE
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.has_role(auth.uid(), 'master'::public.app_role));

CREATE OR REPLACE FUNCTION public.contact_tags_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_tags_updated_at ON public.contact_tags;
CREATE TRIGGER trg_contact_tags_updated_at
  BEFORE UPDATE ON public.contact_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.contact_tags_set_updated_at();

NOTIFY pgrst, 'reload schema';