UPDATE public.sms_templates
SET template_body = 'Hi {{contact.first_name}}, we have a roof replacement estimate prepared for {{contact.full_address}}. What''s the best email to send it to?'
WHERE goal = 'collect_homeowner_email_for_roof_estimate'
  AND template_body LIKE '%{{contact.address1}}, {{contact.city}}%';

UPDATE public.sms_templates
SET template_body = 'Hi {{contact.first_name}}, we have a roof replacement estimate ready for {{contact.full_address}}. What email should we send it to?'
WHERE goal = 'collect_homeowner_email_for_roof_estimate'
  AND template_body LIKE '%{{contact.address1}}%'
  AND template_body NOT LIKE '%{{contact.full_address}}%';