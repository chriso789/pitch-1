CREATE TABLE public.automation_rule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  trigger_event text NOT NULL REFERENCES public.event_types(key),
  trigger_scope text NOT NULL DEFAULT 'entity',
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_cooldown_seconds integer NOT NULL DEFAULT 0,
  default_max_runs_per_entity_per_day integer,
  is_recommended boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX automation_rule_templates_category_idx
  ON public.automation_rule_templates(category, is_active, sort_order);

ALTER TABLE public.automation_rule_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates readable by authenticated"
  ON public.automation_rule_templates FOR SELECT
  TO authenticated
  USING (is_active = true OR public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "templates master insert"
  ON public.automation_rule_templates FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "templates master update"
  ON public.automation_rule_templates FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "templates master delete"
  ON public.automation_rule_templates FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role));

CREATE TRIGGER set_art_updated_at
  BEFORE UPDATE ON public.automation_rule_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();