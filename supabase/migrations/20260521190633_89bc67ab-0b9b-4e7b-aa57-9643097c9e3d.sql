
-- 1. Prevent duplicate templates per tenant+goal+name going forward
CREATE UNIQUE INDEX IF NOT EXISTS sms_templates_tenant_goal_name_uniq
  ON public.sms_templates (tenant_id, goal, template_name);

-- 2. Idempotent seed of strong templates per tenant
DO $$
DECLARE
  v_tenant RECORD;
  v_template RECORD;
  v_templates JSONB := '[
    {"goal":"collect_homeowner_email_for_roof_estimate","category":"roof_estimate","name":"Roof Estimate Email Capture — Direct","body":"Hi {{contact.first_name}}, we have a roof replacement estimate ready for {{contact.address_street}}. What''s the best email to send it to?\n\nWe can also help walk you through the My Safe Florida Home Program if the roof qualifies."},
    {"goal":"collect_homeowner_email_for_roof_estimate","category":"roof_estimate","name":"Roof Estimate Email Capture — Grant Angle","body":"Hi {{contact.first_name}}, we put together roof replacement pricing for {{contact.address_street}}. Send over the best email and we''ll get it to you.\n\nThere may also be up to $10,000 available through My Safe Florida Home for qualifying roof replacements."},
    {"goal":"collect_homeowner_email_for_roof_estimate","category":"roof_estimate","name":"Roof Estimate Email Capture — Soft Local","body":"Hi {{contact.first_name}}, quick follow-up on {{contact.address_street}}. We have roof replacement numbers ready and just need the best email to send them to.\n\nWe can also help explain the My Safe Florida Home grant process."},
    {"goal":"msfh_grant","category":"grant_followup","name":"MSFH Grant — Education First","body":"Hi {{contact.first_name}}, Florida has a roof grant program called My Safe Florida Home that may help qualified homeowners with roof replacement costs.\n\nWe help homeowners understand the steps and paperwork. Want us to check {{contact.address_street}}?"},
    {"goal":"msfh_grant","category":"grant_followup","name":"MSFH Grant — Inspection Angle","body":"Hi {{contact.first_name}}, My Safe Florida Home usually starts with eligibility and inspection steps. We help homeowners figure out what applies before they waste time.\n\nWant us to review {{contact.address_street}}?"},
    {"goal":"msfh_grant","category":"grant_followup","name":"MSFH Grant — Simple Ask","body":"Hi {{contact.first_name}}, we''re helping Florida homeowners understand the My Safe Florida Home roof grant process.\n\nWould you like help checking whether {{contact.address_street}} may qualify?"},
    {"goal":"storm_canvass","category":"storm_followup","name":"Storm Canvass — Neighborly","body":"Hi {{contact.first_name}}, we''re checking roofs near {{contact.address_street}} after recent weather. Small roof issues can turn into leaks fast in Florida.\n\nWould you like us to take a look?"},
    {"goal":"storm_canvass","category":"storm_followup","name":"Storm Canvass — Estimate","body":"Hi {{contact.first_name}}, we''re following up on {{contact.address_street}} after recent storms. We can check for missing shingles, lifted flashing, soft spots, or leak risks.\n\nWant a quick roof review?"},
    {"goal":"storm_canvass","category":"storm_followup","name":"Storm Canvass — Insurance Awareness","body":"Hi {{contact.first_name}}, if {{contact.address_street}} took wind or storm damage, it''s better to document it before leaks show up.\n\nWould you like us to inspect and document the roof condition?"},
    {"goal":"dormant_reactivation","category":"reactivation","name":"Dormant Reactivation — Still Interested","body":"Hi {{contact.first_name}}, we had {{contact.address_street}} in our system from a previous roofing conversation. Are you still considering repair or replacement options?"},
    {"goal":"dormant_reactivation","category":"reactivation","name":"Dormant Reactivation — Pricing Changed","body":"Hi {{contact.first_name}}, following up on {{contact.address_street}}. Roofing prices, grants, and financing options may have changed since we last spoke.\n\nWant us to update the numbers?"},
    {"goal":"dormant_reactivation","category":"reactivation","name":"Dormant Reactivation — Soft Check-In","body":"Hi {{contact.first_name}}, checking back in on {{contact.address_street}}. Did you ever move forward with the roof, or are you still comparing options?"},
    {"goal":"general_outreach","category":"general","name":"General Outreach — Property Specific","body":"Hi {{contact.first_name}}, this is {{company.name}} following up about {{contact.address_street}}. Would you like us to send over roof options or schedule a quick review?"},
    {"goal":"general_outreach","category":"general","name":"General Outreach — Simple Follow-Up","body":"Hi {{contact.first_name}}, just following up from {{company.name}}. Do you still need help with anything roof-related at {{contact.address_street}}?"},
    {"goal":"general_outreach","category":"general","name":"General Outreach — Local Roofing Help","body":"Hi {{contact.first_name}}, we help Florida homeowners with roof repairs, replacements, inspections, and storm documentation.\n\nWould you like help with {{contact.address_street}}?"}
  ]'::jsonb;
BEGIN
  FOR v_tenant IN SELECT DISTINCT tenant_id FROM public.user_company_access WHERE tenant_id IS NOT NULL LOOP
    FOR v_template IN SELECT * FROM jsonb_to_recordset(v_templates) AS x(goal text, category text, name text, body text) LOOP
      INSERT INTO public.sms_templates (tenant_id, template_name, template_body, category, goal, active)
      VALUES (v_tenant.tenant_id, v_template.name, v_template.body, v_template.category, v_template.goal, true)
      ON CONFLICT (tenant_id, goal, template_name)
      DO UPDATE SET
        template_body = EXCLUDED.template_body,
        category = EXCLUDED.category,
        active = true,
        updated_at = now();
    END LOOP;
  END LOOP;
END $$;
