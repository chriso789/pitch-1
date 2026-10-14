CREATE TABLE public.tenant_pdf_tool_settings (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tool text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, tool)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_pdf_tool_settings TO authenticated;
GRANT ALL ON public.tenant_pdf_tool_settings TO service_role;
ALTER TABLE public.tenant_pdf_tool_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.pdf_tool_admin(_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.pdf_compare_member(_tenant) AND (
    public.has_role(auth.uid(),'master'::app_role) OR public.has_role(auth.uid(),'owner'::app_role)
    OR public.has_role(auth.uid(),'corporate'::app_role) OR public.has_role(auth.uid(),'office_admin'::app_role));
$$;
REVOKE EXECUTE ON FUNCTION public.pdf_tool_admin(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pdf_tool_admin(uuid) TO authenticated;

CREATE POLICY "members read pdf tool settings" ON public.tenant_pdf_tool_settings FOR SELECT TO authenticated USING (public.pdf_compare_member(tenant_id));
CREATE POLICY "admins add pdf tool settings" ON public.tenant_pdf_tool_settings FOR INSERT TO authenticated WITH CHECK (public.pdf_tool_admin(tenant_id) AND updated_by = auth.uid());
CREATE POLICY "admins change pdf tool settings" ON public.tenant_pdf_tool_settings FOR UPDATE TO authenticated USING (public.pdf_tool_admin(tenant_id)) WITH CHECK (public.pdf_tool_admin(tenant_id) AND updated_by = auth.uid());
CREATE POLICY "admins remove pdf tool settings" ON public.tenant_pdf_tool_settings FOR DELETE TO authenticated USING (public.pdf_tool_admin(tenant_id));

CREATE OR REPLACE FUNCTION public.pdf_tool_settings_validate() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.tool NOT IN ('pageTools','compare','ocr','protect','batch','health') THEN
    RAISE EXCEPTION 'Unknown PDF tool %', NEW.tool;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER pdf_tool_settings_validate BEFORE INSERT OR UPDATE ON public.tenant_pdf_tool_settings
FOR EACH ROW EXECUTE FUNCTION public.pdf_tool_settings_validate();

CREATE OR REPLACE FUNCTION public.pdf_tool_enabled(_tenant uuid, _tool text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT enabled FROM public.tenant_pdf_tool_settings WHERE tenant_id=_tenant AND tool=_tool), _tool = 'pageTools');
$$;
REVOKE EXECUTE ON FUNCTION public.pdf_tool_enabled(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pdf_tool_enabled(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.documents_pdf_tool_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.metadata ? 'versions_root_id' AND auth.role() <> 'service_role' THEN
    IF NOT (NEW.metadata ? 'pdf_tool') OR NOT public.pdf_tool_enabled(NEW.tenant_id, NEW.metadata->>'pdf_tool') THEN
      RAISE EXCEPTION 'This PDF tool is not switched on for this company' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_pdf_tool_guard BEFORE INSERT ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.documents_pdf_tool_guard();