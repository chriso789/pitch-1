-- Delete duplicate Fred Lester contact (keep older one)
DELETE FROM contacts WHERE id = 'be6dabcd-0a75-4bf4-bff3-fae756f55bdc';

-- Create pipeline entry for the remaining Fred Lester contact
INSERT INTO pipeline_entries (
  tenant_id,
  contact_id,
  status,
  priority,
  assigned_to,
  created_by,
  location_id
) VALUES (
  '5a02983a-3d4d-4d5e-af01-7f2c7f02e78c',
  '41922a2e-230a-44c8-a12b-541ef04dc5dc',
  'lead',
  'medium',
  'dc2c4ffb-261a-4b04-87a4-cc69af975295',
  'dc2c4ffb-261a-4b04-87a4-cc69af975295',
  NULL
);