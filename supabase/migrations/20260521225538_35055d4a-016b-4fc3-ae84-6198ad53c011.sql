
-- 1. Normalized columns
ALTER TABLE public.sms_templates
  ADD COLUMN IF NOT EXISTS normalized_template_name text,
  ADD COLUMN IF NOT EXISTS normalized_template_body text;

-- 2. Backfill
UPDATE public.sms_templates
SET normalized_template_name = lower(regexp_replace(trim(template_name), '\s+', ' ', 'g')),
    normalized_template_body = lower(regexp_replace(trim(template_body), '\s+', ' ', 'g'))
WHERE normalized_template_name IS NULL OR normalized_template_body IS NULL;

-- 3. Trigger to maintain normalized columns + updated_at
CREATE OR REPLACE FUNCTION public.set_sms_template_normalized_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.normalized_template_name := lower(regexp_replace(trim(coalesce(NEW.template_name,'')), '\s+', ' ', 'g'));
  NEW.normalized_template_body := lower(regexp_replace(trim(coalesce(NEW.template_body,'')), '\s+', ' ', 'g'));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sms_template_normalized_fields ON public.sms_templates;
CREATE TRIGGER trg_set_sms_template_normalized_fields
BEFORE INSERT OR UPDATE ON public.sms_templates
FOR EACH ROW EXECUTE FUNCTION public.set_sms_template_normalized_fields();

-- 4. Duplicate cleanup (keep oldest, lowest id on tie)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id,
                        coalesce(goal,'general_outreach'),
                        normalized_template_name,
                        normalized_template_body
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.sms_templates
  WHERE active = true
)
UPDATE public.sms_templates t
SET active = false,
    template_name = t.template_name || ' (duplicate inactive)',
    updated_at = now()
FROM ranked
WHERE t.id = ranked.id
  AND ranked.rn > 1;

-- 5. Unique partial index
CREATE UNIQUE INDEX IF NOT EXISTS sms_templates_unique_active_template_idx
ON public.sms_templates (
  tenant_id,
  (coalesce(goal,'general_outreach')),
  normalized_template_name,
  normalized_template_body
)
WHERE active = true;

-- 6. Upsert helper
CREATE OR REPLACE FUNCTION public.upsert_sms_template(
  p_tenant_id uuid,
  p_template_name text,
  p_template_body text,
  p_category text,
  p_goal text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_name text := lower(regexp_replace(trim(coalesce(p_template_name,'')), '\s+', ' ', 'g'));
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.sms_templates
  WHERE tenant_id = p_tenant_id
    AND coalesce(goal,'general_outreach') = coalesce(p_goal,'general_outreach')
    AND normalized_template_name = v_norm_name
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.sms_templates
    SET template_body = p_template_body,
        category = p_category,
        goal = p_goal,
        active = true,
        template_name = regexp_replace(p_template_name, ' \(duplicate inactive\)$', '')
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.sms_templates (tenant_id, template_name, template_body, category, goal, active)
  VALUES (p_tenant_id, p_template_name, p_template_body, p_category, p_goal, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 7. Seed approved templates per tenant
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM public.upsert_sms_template(t.id, 'Roof Estimate Email Capture — Direct', E'Hi {{contact.first_name}}, we have a roof replacement estimate ready for {{contact.address_street}}. What''s the best email to send it to?\n\nWe can also help walk you through the My Safe Florida Home Program if the roof qualifies.', 'roof_estimate', 'collect_homeowner_email_for_roof_estimate');
    PERFORM public.upsert_sms_template(t.id, 'Roof Estimate Email Capture — Grant Angle', E'Hi {{contact.first_name}}, we put together roof replacement pricing for {{contact.address_street}}. Send over the best email and we''ll get it to you.\n\nThere may also be up to $10,000 available through My Safe Florida Home for qualifying roof replacements.', 'roof_estimate', 'collect_homeowner_email_for_roof_estimate');
    PERFORM public.upsert_sms_template(t.id, 'Roof Estimate Email Capture — Soft Local', E'Hi {{contact.first_name}}, quick follow-up on {{contact.address_street}}. We have roof replacement numbers ready and just need the best email to send them to.\n\nWe can also help explain the My Safe Florida Home grant process.', 'roof_estimate', 'collect_homeowner_email_for_roof_estimate');

    PERFORM public.upsert_sms_template(t.id, 'MSFH Grant — Education First', E'Hi {{contact.first_name}}, Florida has a roof grant program called My Safe Florida Home that may help qualified homeowners with roof replacement costs.\n\nWe help homeowners understand the steps and paperwork. Want us to check {{contact.address_street}}?', 'grant_followup', 'msfh_grant');
    PERFORM public.upsert_sms_template(t.id, 'MSFH Grant — Inspection Angle', E'Hi {{contact.first_name}}, My Safe Florida Home usually starts with eligibility and inspection steps. We help homeowners figure out what applies before they waste time.\n\nWant us to review {{contact.address_street}}?', 'grant_followup', 'msfh_grant');
    PERFORM public.upsert_sms_template(t.id, 'MSFH Grant — Simple Ask', E'Hi {{contact.first_name}}, we''re helping Florida homeowners understand the My Safe Florida Home roof grant process.\n\nWould you like help checking whether {{contact.address_street}} may qualify?', 'grant_followup', 'msfh_grant');

    PERFORM public.upsert_sms_template(t.id, 'Storm Canvass — Neighborly', E'Hi {{contact.first_name}}, we''re checking roofs near {{contact.address_street}} after recent weather. Small roof issues can turn into leaks fast in Florida.\n\nWould you like us to take a look?', 'storm_followup', 'storm_canvass');
    PERFORM public.upsert_sms_template(t.id, 'Storm Canvass — Estimate', E'Hi {{contact.first_name}}, we''re following up on {{contact.address_street}} after recent storms. We can check for missing shingles, lifted flashing, soft spots, or leak risks.\n\nWant a quick roof review?', 'storm_followup', 'storm_canvass');
    PERFORM public.upsert_sms_template(t.id, 'Storm Canvass — Insurance Awareness', E'Hi {{contact.first_name}}, if {{contact.address_street}} took wind or storm damage, it''s better to document it before leaks show up.\n\nWould you like us to inspect and document the roof condition?', 'storm_followup', 'storm_canvass');

    PERFORM public.upsert_sms_template(t.id, 'Dormant Lead Reactivation — Still Interested', E'Hi {{contact.first_name}}, we had {{contact.address_street}} in our system from a previous roofing conversation. Are you still considering repair or replacement options?', 'reactivation', 'dormant_reactivation');
    PERFORM public.upsert_sms_template(t.id, 'Dormant Lead Reactivation — Pricing Changed', E'Hi {{contact.first_name}}, following up on {{contact.address_street}}. Roofing prices, grants, and financing options may have changed since we last spoke.\n\nWant us to update the numbers?', 'reactivation', 'dormant_reactivation');
    PERFORM public.upsert_sms_template(t.id, 'Dormant Lead Reactivation — Soft Check-In', E'Hi {{contact.first_name}}, checking back in on {{contact.address_street}}. Did you ever move forward with the roof, or are you still comparing options?', 'reactivation', 'dormant_reactivation');

    PERFORM public.upsert_sms_template(t.id, 'General Outreach — Property Specific', E'Hi {{contact.first_name}}, this is {{company.name}} following up about {{contact.address_street}}. Would you like us to send over roof options or schedule a quick review?', 'general', 'general_outreach');
    PERFORM public.upsert_sms_template(t.id, 'General Outreach — Simple Follow-Up', E'Hi {{contact.first_name}}, just following up from {{company.name}}. Do you still need help with anything roof-related at {{contact.address_street}}?', 'general', 'general_outreach');
    PERFORM public.upsert_sms_template(t.id, 'General Outreach — Local Roofing Help', E'Hi {{contact.first_name}}, we help Florida homeowners with roof repairs, replacements, inspections, and storm documentation.\n\nWould you like help with {{contact.address_street}}?', 'general', 'general_outreach');
  END LOOP;
END $$;
