CREATE OR REPLACE FUNCTION public.pdf_compare_member(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT _tenant = public.get_user_tenant_id() AND NOT public.is_login_blocked()
    AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=_tenant AND t.is_active=true)
    AND (public.has_role(auth.uid(),'master'::public.app_role)
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.tenant_id=_tenant)
      OR EXISTS (SELECT 1 FROM public.user_company_access a WHERE a.user_id=auth.uid() AND a.tenant_id=_tenant AND a.is_active=true))
$$;

CREATE TABLE public.pdf_revision_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  base_document_id uuid NOT NULL REFERENCES public.documents(id),
  revised_document_id uuid NOT NULL REFERENCES public.documents(id),
  page integer NOT NULL CHECK (page >= 1),
  offset_x integer NOT NULL DEFAULT 0,
  offset_y integer NOT NULL DEFAULT 0,
  render_width integer NOT NULL,
  render_height integer NOT NULL,
  regions jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (base_document_id <> revised_document_id)
);
GRANT SELECT, INSERT ON public.pdf_revision_comparisons TO authenticated;
GRANT ALL ON public.pdf_revision_comparisons TO service_role;
ALTER TABLE public.pdf_revision_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY prc_read ON public.pdf_revision_comparisons FOR SELECT TO authenticated USING (public.pdf_compare_member(tenant_id));
CREATE POLICY prc_insert ON public.pdf_revision_comparisons FOR INSERT TO authenticated WITH CHECK (
  created_by=auth.uid() AND public.pdf_compare_member(tenant_id)
  AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id=base_document_id AND d.tenant_id=pdf_revision_comparisons.tenant_id)
  AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id=revised_document_id AND d.tenant_id=pdf_revision_comparisons.tenant_id));
CREATE INDEX prc_tenant_doc ON public.pdf_revision_comparisons(tenant_id, revised_document_id, created_at DESC);

CREATE FUNCTION public.pdf_revision_comparisons_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Saved comparisons are permanent records; save a new comparison instead'; END $$;
CREATE TRIGGER pdf_revision_comparisons_immutable BEFORE UPDATE OR DELETE ON public.pdf_revision_comparisons FOR EACH ROW EXECUTE FUNCTION public.pdf_revision_comparisons_immutable();

CREATE TABLE public.pdf_revision_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  comparison_id uuid NOT NULL REFERENCES public.pdf_revision_comparisons(id),
  region_index integer NOT NULL CHECK (region_index >= 0),
  item_type text NOT NULL CHECK (item_type IN ('rfi','change_order_review','takeoff_task')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notes text CHECK (notes IS NULL OR length(notes) <= 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.pdf_revision_review_items TO authenticated;
GRANT ALL ON public.pdf_revision_review_items TO service_role;
ALTER TABLE public.pdf_revision_review_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY prri_read ON public.pdf_revision_review_items FOR SELECT TO authenticated USING (public.pdf_compare_member(tenant_id));
CREATE POLICY prri_insert ON public.pdf_revision_review_items FOR INSERT TO authenticated WITH CHECK (
  created_by=auth.uid() AND public.pdf_compare_member(tenant_id)
  AND EXISTS (SELECT 1 FROM public.pdf_revision_comparisons c WHERE c.id=comparison_id AND c.tenant_id=pdf_revision_review_items.tenant_id));
CREATE POLICY prri_update ON public.pdf_revision_review_items FOR UPDATE TO authenticated USING (public.pdf_compare_member(tenant_id)) WITH CHECK (public.pdf_compare_member(tenant_id));
CREATE INDEX prri_comparison ON public.pdf_revision_review_items(comparison_id);

-- Only status may change; everything else is locked.
CREATE FUNCTION public.pdf_revision_review_items_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.comparison_id<>OLD.comparison_id OR NEW.region_index<>OLD.region_index
     OR NEW.item_type<>OLD.item_type OR NEW.title<>OLD.title OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Only the status of a review item can change';
  END IF;
  NEW.updated_at := now();
  IF NEW.status<>'open' AND OLD.status='open' THEN NEW.resolved_by := auth.uid(); NEW.resolved_at := now(); END IF;
  IF NEW.status='open' THEN NEW.resolved_by := NULL; NEW.resolved_at := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pdf_revision_review_items_guard BEFORE UPDATE ON public.pdf_revision_review_items FOR EACH ROW EXECUTE FUNCTION public.pdf_revision_review_items_guard();