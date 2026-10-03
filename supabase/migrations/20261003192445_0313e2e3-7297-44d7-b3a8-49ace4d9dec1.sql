CREATE TABLE public.company_reputation_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  show_on_invoice boolean NOT NULL DEFAULT true,
  headline text NOT NULL DEFAULT 'Share your experience',
  message text NOT NULL DEFAULT 'Your feedback helps other homeowners. We''d appreciate an honest review.',
  feedback_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_reputation_settings TO authenticated;
GRANT ALL ON public.company_reputation_settings TO service_role;
ALTER TABLE public.company_reputation_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.review_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'google' CHECK (platform IN ('google','facebook','yelp','bbb','angi','houzz','nextdoor','other')),
  label text NOT NULL,
  url text NOT NULL CHECK (url ~* '^https://'),
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.review_destinations(tenant_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_destinations TO authenticated;
GRANT ALL ON public.review_destinations TO service_role;
ALTER TABLE public.review_destinations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.review_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  destination_id uuid REFERENCES public.review_destinations(id) ON DELETE SET NULL,
  delivery_id uuid REFERENCES public.invoice_email_deliveries(id) ON DELETE SET NULL,
  project_id uuid,
  contact_id uuid,
  platform text,
  user_agent text,
  clicked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.review_link_clicks(tenant_id, clicked_at DESC);
GRANT SELECT ON public.review_link_clicks TO authenticated;
GRANT ALL ON public.review_link_clicks TO service_role;
ALTER TABLE public.review_link_clicks ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.closeout_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  delivery_id uuid REFERENCES public.invoice_email_deliveries(id) ON DELETE SET NULL,
  project_id uuid,
  contact_id uuid,
  rating int CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (char_length(comment) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id)
);
CREATE INDEX ON public.closeout_feedback(tenant_id, created_at DESC);
GRANT SELECT ON public.closeout_feedback TO authenticated;
GRANT ALL ON public.closeout_feedback TO service_role;
ALTER TABLE public.closeout_feedback ENABLE ROW LEVEL SECURITY;

-- Compliance: block incentive / sentiment-gating language on review copy
CREATE OR REPLACE FUNCTION public.reputation_assert_compliant(_text text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF _text IS NULL THEN RETURN; END IF;
  IF _text ~* '(5[- ]?star|five[- ]?star|positive review|good review|reward|gift card|discount|prize|unlock|in exchange|free )' THEN
    RAISE EXCEPTION 'Review wording cannot ask for a specific rating or offer anything in exchange for a review.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reputation_settings_compliance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.reputation_assert_compliant(NEW.headline);
  PERFORM public.reputation_assert_compliant(NEW.message);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_reputation_settings_compliance BEFORE INSERT OR UPDATE ON public.company_reputation_settings
FOR EACH ROW EXECUTE FUNCTION public.reputation_settings_compliance();

CREATE OR REPLACE FUNCTION public.review_destination_compliance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.reputation_assert_compliant(NEW.label);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_review_destination_compliance BEFORE INSERT OR UPDATE ON public.review_destinations
FOR EACH ROW EXECUTE FUNCTION public.review_destination_compliance();

CREATE POLICY "tenant members manage reputation settings" ON public.company_reputation_settings
FOR ALL TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid() UNION SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()))
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid() UNION SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()));
CREATE POLICY "tenant members manage review destinations" ON public.review_destinations
FOR ALL TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid() UNION SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()))
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid() UNION SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()));
CREATE POLICY "tenant members view review clicks" ON public.review_link_clicks
FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid() UNION SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()));
CREATE POLICY "tenant members view closeout feedback" ON public.closeout_feedback
FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid() UNION SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()));