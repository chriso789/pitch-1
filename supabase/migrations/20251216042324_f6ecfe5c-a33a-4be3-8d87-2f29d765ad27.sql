-- Delete corrupted Door Knock contacts that are unassigned
DELETE FROM contacts 
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  AND assigned_to IS NULL 
  AND lead_source = 'Door Knock';