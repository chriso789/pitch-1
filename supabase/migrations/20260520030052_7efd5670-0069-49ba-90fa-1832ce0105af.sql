
CREATE TABLE IF NOT EXISTS public.sms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  template_name text NOT NULL,
  template_body text NOT NULL,
  category text DEFAULT 'general',
  goal text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_templates_tenant ON public.sms_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sms_templates_goal ON public.sms_templates(tenant_id, goal) WHERE active = true;

ALTER TABLE public.sms_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view sms_templates"
  ON public.sms_templates FOR SELECT
  USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "Tenant users can insert sms_templates"
  ON public.sms_templates FOR INSERT
  WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "Tenant users can update sms_templates"
  ON public.sms_templates FOR UPDATE
  USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "Tenant users can delete sms_templates"
  ON public.sms_templates FOR DELETE
  USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE TRIGGER trg_sms_templates_updated_at
  BEFORE UPDATE ON public.sms_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sms_blasts
  ADD COLUMN IF NOT EXISTS template_pool_ids uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS ai_followup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS send_window_start time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS send_window_end time NOT NULL DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS goal text;

ALTER TABLE public.sms_blast_items
  ADD COLUMN IF NOT EXISTS personalized_message text,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.sms_templates(id) ON DELETE SET NULL;

INSERT INTO public.sms_templates (tenant_id, template_name, template_body, category, goal)
SELECT t.id,
       'MSFH — Default (Consultative)',
       E'Hi {{contact.first_name}}, this is {{assigned_user.first_name}} with {{company.name}}.\n\nWe''ve been helping homeowners around {{contact.address1}} navigate the My Safe Florida Home program and wanted to reach out in case you hadn''t looked into it yet.\n\nA lot of homeowners qualify for grant funding toward roof and wind mitigation improvements but aren''t always sure how the process works. We help walk homeowners through it step-by-step and simplify the inspection and application.\n\nIf you''d ever like more information regarding your property, feel free to reply here anytime.',
       'msfh',
       'msfh_grant'
FROM public.tenants t;

INSERT INTO public.sms_templates (tenant_id, template_name, template_body, category, goal)
SELECT t.id,
       'MSFH — Short Variant',
       E'Hey {{contact.first_name}} — {{assigned_user.first_name}} here with {{company.name}}. Quick note: the My Safe Florida Home grant is still funding roof & wind-mitigation work for homeowners in {{contact.city}}. Happy to walk you through how it works if you''d like. No pressure either way.',
       'msfh',
       'msfh_grant'
FROM public.tenants t;

INSERT INTO public.sms_templates (tenant_id, template_name, template_body, category, goal)
SELECT t.id,
       'MSFH — Inspection-Focused',
       E'Hi {{contact.first_name}}, this is {{assigned_user.first_name}} with {{company.name}}. The state''s offering free wind mitigation inspections under My Safe Florida Home — homeowners around {{contact.address1}} have been using them to qualify for grant funds on roof work. Want me to send over the details?',
       'msfh',
       'msfh_grant'
FROM public.tenants t;

INSERT INTO public.sms_templates (tenant_id, template_name, template_body, category, goal)
SELECT t.id,
       'MSFH — Neighborhood Mention',
       E'Hi {{contact.first_name}}, {{assigned_user.first_name}} with {{company.name}}. A few of your neighbors in {{contact.city}} have been applying for the My Safe Florida Home grant for roof & wind upgrades. Just wanted to make sure you knew about it — reply here if you''d like the rundown.',
       'msfh',
       'msfh_grant'
FROM public.tenants t;
