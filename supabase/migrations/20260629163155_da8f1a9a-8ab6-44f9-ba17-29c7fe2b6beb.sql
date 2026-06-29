
-- Revoke the existing OB Growth Hub key
UPDATE public.company_api_keys
SET is_active = false,
    revoked_at = now()
WHERE id = '3466e8b1-702c-4c44-acca-da4ceee044a5';

-- Insert the new rotated key (hash of plaintext: pk_live_obc_gh_74ea48a1d3cf783989af50085d1271dd78128f301b0e28fc)
INSERT INTO public.company_api_keys (
  tenant_id,
  api_key_hash,
  key_prefix,
  name,
  description,
  permissions,
  is_active,
  rate_limit_per_hour,
  default_assignee_id
) VALUES (
  '14de934e-7964-4afd-940a-620d2ace125d',
  '578f26d7b34542e9f0d5bfb144a6e73df77e9b83c9f56ecf8fcd5531e7e93d14',
  'pk_live_',
  'OB Growth Hub',
  'Rotated 2026-06-29 — receives OBC Growth Hub leads, default-routed to West Coast via location_code=WC',
  ARRAY['lead_submission'],
  true,
  500,
  '248aad6c-e652-4645-97c3-675d8feb8730'
);
