-- One-off backfill: merge canvass enrichment data into the HAMMONS contact
-- Pulls phones/emails from canvassiq_properties (where they were stored)
-- into the contacts row so they show up in the CRM, calls, SMS, and email.
UPDATE public.contacts
SET
  phone = COALESCE(NULLIF(phone, ''), '8133519874'),
  secondary_phone = COALESCE(NULLIF(secondary_phone, ''), '8135465251'),
  additional_phones = ARRAY['8135465213','7025816053','8136454908']::text[],
  email = COALESCE(NULLIF(email, ''), 'hbsurfers@yahoo.com'),
  secondary_email = COALESCE(NULLIF(secondary_email, ''), 'hopebrown84@yahoo.com'),
  canvassiq_property_id = COALESCE(canvassiq_property_id, '34c4a542-e920-42d2-a30a-46e8376eca84'::uuid),
  updated_at = NOW()
WHERE id = '3ebe0928-2f32-4610-8931-9e29aadd8870';

-- Link the property record back to this contact
UPDATE public.canvassiq_properties
SET contact_id = '3ebe0928-2f32-4610-8931-9e29aadd8870'
WHERE id = '34c4a542-e920-42d2-a30a-46e8376eca84'
  AND contact_id IS NULL;