-- Clean up orphaned template_items (items linked to deleted templates)
DELETE FROM template_items 
WHERE template_id NOT IN (SELECT id FROM estimate_calculation_templates);

-- Clean up orphaned estimate_template_groups (groups linked to deleted templates)
DELETE FROM estimate_template_groups 
WHERE template_id NOT IN (SELECT id FROM estimate_calculation_templates);