
-- 1) Seed two reusable SMS campaign templates per tenant for the email-capture flow.
INSERT INTO public.sms_templates (tenant_id, template_name, template_body, category, goal, active)
SELECT
  t.id,
  'Roof Estimate Email Capture — MSFH',
  'Hi {{contact.first_name}}, we have a roof replacement estimate prepared for {{contact.address1}}, {{contact.city}}. What''s the best email to send it to?'
  || E'\n\n'
  || 'We can also help you through the My Safe Florida Home Program, which may provide up to $10,000 toward a qualifying roof replacement.',
  'msfh_email_capture',
  'collect_homeowner_email_for_roof_estimate',
  true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.sms_templates s
  WHERE s.tenant_id = t.id
    AND s.template_name = 'Roof Estimate Email Capture — MSFH'
);

INSERT INTO public.sms_templates (tenant_id, template_name, template_body, category, goal, active)
SELECT
  t.id,
  'Roof Estimate Email Capture — MSFH (Short)',
  'Hi {{contact.first_name}}, we have a roof replacement estimate ready for {{contact.address1}}. What email should we send it to?'
  || E'\n\n'
  || 'We also help homeowners apply for the My Safe Florida Home roof grant program.',
  'msfh_email_capture',
  'collect_homeowner_email_for_roof_estimate',
  true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.sms_templates s
  WHERE s.tenant_id = t.id
    AND s.template_name = 'Roof Estimate Email Capture — MSFH (Short)'
);

-- 2) Seed the roof_estimate_email_captured pipeline stage per tenant, placed right after msfh_interested if it exists, else at the end.
INSERT INTO public.pipeline_stages (
  tenant_id, name, key, description, color,
  probability_percent, stage_order, is_active, is_terminal
)
SELECT
  t.id,
  'Roof Estimate Email Captured',
  'roof_estimate_email_captured',
  'Homeowner replied with an email for us to send the roof replacement estimate. Send estimate + MSFH info within 15 minutes.',
  '#10b981',
  COALESCE(
    (SELECT probability_percent FROM public.pipeline_stages
       WHERE tenant_id = t.id AND key = 'msfh_interested' LIMIT 1),
    40
  ),
  COALESCE(
    (SELECT stage_order FROM public.pipeline_stages
       WHERE tenant_id = t.id AND key = 'msfh_interested' LIMIT 1),
    (SELECT COALESCE(MAX(stage_order), 0) FROM public.pipeline_stages WHERE tenant_id = t.id)
  ) + 1,
  true,
  false
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.pipeline_stages p
  WHERE p.tenant_id = t.id AND p.key = 'roof_estimate_email_captured'
);
