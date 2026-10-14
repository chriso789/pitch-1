CREATE OR REPLACE FUNCTION public.documents_pdf_tool_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.metadata ? 'versions_root_id' OR NEW.metadata ? 'pdf_tool' OR NEW.metadata ? 'converted_from') AND auth.role() <> 'service_role' THEN
    IF NOT (NEW.metadata ? 'pdf_tool') OR NOT public.pdf_tool_enabled(NEW.tenant_id, NEW.metadata->>'pdf_tool') THEN
      RAISE EXCEPTION 'This PDF tool is not switched on for this company' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.documents_pdf_tool_guard() FROM anon, authenticated, public;