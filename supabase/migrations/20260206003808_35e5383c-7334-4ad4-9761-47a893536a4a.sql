-- Fix existing metal estimate short descriptions
UPDATE enhanced_estimates 
SET short_description = '5V Metal Premium' 
WHERE id = '0c38ca37-cb89-413a-a659-3f7d4cfc8f09';

UPDATE enhanced_estimates 
SET short_description = 'SnapLok Premium' 
WHERE id = 'f1571ce2-dba8-4db9-8a9e-130c104d06a0';