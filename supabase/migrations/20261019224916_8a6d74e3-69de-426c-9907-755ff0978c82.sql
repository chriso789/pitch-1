CREATE TABLE public.photo_training_contributions (
  tenant_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'not_enrolled' CHECK (status IN ('not_enrolled','opted_in','withdrawn')),
  terms_version text,
  authorized_by uuid,
  authorized_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.photo_training_contributions TO authenticated;
GRANT ALL ON public.photo_training_contributions TO service_role;
ALTER TABLE public.photo_training_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own company contribution" ON public.photo_training_contributions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_training_contributions.tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.photo_training_contribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  terms_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.photo_training_contribution_events TO authenticated;
GRANT ALL ON public.photo_training_contribution_events TO service_role;
ALTER TABLE public.photo_training_contribution_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own company contribution history" ON public.photo_training_contribution_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_training_contribution_events.tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.platform_training_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_training_access_log TO authenticated;
GRANT ALL ON public.platform_training_access_log TO service_role;
ALTER TABLE public.platform_training_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform admins read access log" ON public.platform_training_access_log FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.set_photo_training_contribution(_tenant_id uuid, _opt_in boolean, _terms_version text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign-in required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = _tenant_id) THEN
    RAISE EXCEPTION 'Not authorized for this company'; END IF;
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'corporate') OR public.has_role(auth.uid(),'office_admin') OR public.has_role(auth.uid(),'master')) THEN
    RAISE EXCEPTION 'Only a company administrator can change training contribution'; END IF;
  IF _opt_in AND coalesce(trim(_terms_version),'') = '' THEN RAISE EXCEPTION 'Data-use terms version is required'; END IF;
  s := CASE WHEN _opt_in THEN 'opted_in' ELSE 'withdrawn' END;
  INSERT INTO public.photo_training_contributions(tenant_id,status,terms_version,authorized_by,authorized_at,withdrawn_at,updated_at)
  VALUES (_tenant_id, s, CASE WHEN _opt_in THEN _terms_version END, auth.uid(), CASE WHEN _opt_in THEN now() END, CASE WHEN NOT _opt_in THEN now() END, now())
  ON CONFLICT (tenant_id) DO UPDATE SET status = s,
    terms_version = CASE WHEN _opt_in THEN _terms_version ELSE photo_training_contributions.terms_version END,
    authorized_by = auth.uid(),
    authorized_at = CASE WHEN _opt_in THEN now() ELSE photo_training_contributions.authorized_at END,
    withdrawn_at = CASE WHEN _opt_in THEN NULL ELSE now() END, updated_at = now();
  INSERT INTO public.photo_training_contribution_events(tenant_id,actor_id,action,terms_version) VALUES (_tenant_id, auth.uid(), s, _terms_version);
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.set_photo_training_contribution(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_photo_training_contribution(uuid,boolean,text) TO authenticated;

-- Counts only: never returns photos, URLs, embeddings, addresses or company names.
CREATE OR REPLACE FUNCTION public.platform_training_overview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN RAISE EXCEPTION 'Platform administrator required'; END IF;
  INSERT INTO public.platform_training_access_log(actor_id, action) VALUES (auth.uid(), 'overview');
  WITH opted AS (SELECT tenant_id FROM public.photo_training_contributions WHERE status = 'opted_in'),
  ex AS (SELECT c.cls, c.condition, c.source_property_key, c.tenant_id FROM public.photo_reference_candidates c
         JOIN opted o ON o.tenant_id = c.tenant_id
         WHERE c.approved_by IS NOT NULL AND coalesce(c.review_status,'approved') = 'approved' AND c.approved_by <> c.labeled_by)
  SELECT jsonb_build_object(
    'companies_total', (SELECT count(DISTINCT tenant_id) FROM public.customer_photos),
    'companies_opted_in', (SELECT count(*) FROM opted),
    'eligible_photos', (SELECT count(*) FROM public.customer_photos p JOIN opted o ON o.tenant_id = p.tenant_id WHERE p.mime_type IS NULL OR p.mime_type LIKE 'image/%')
       + (SELECT count(*) FROM public.canvass_photos p JOIN opted o ON o.tenant_id = p.tenant_id),
    'approved_examples', (SELECT count(*) FROM ex),
    'properties', (SELECT count(DISTINCT tenant_id::text || source_property_key) FROM ex),
    'by_class', coalesce((SELECT jsonb_agg(jsonb_build_object('cls', cls, 'condition', condition, 'examples', n, 'properties', p, 'companies', t)) FROM
        (SELECT cls, condition, count(*) n, count(DISTINCT tenant_id::text || source_property_key) p, count(DISTINCT tenant_id) t FROM ex GROUP BY cls, condition) g), '[]'::jsonb),
    'pooling_active', false
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.platform_training_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_training_overview() TO authenticated;