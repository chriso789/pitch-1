-- Seed the estimate_template_attachments table to link the metal roof flyer to metal templates
-- Using estimate_templates table which is the correct FK reference

INSERT INTO estimate_template_attachments (tenant_id, template_id, document_id, attachment_order)
SELECT 
  t.tenant_id,
  t.id as template_id,
  '9c38279e-4eff-47b2-9506-2a34897a8250'::uuid as document_id,
  0 as attachment_order
FROM estimate_templates t
WHERE t.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  AND (
    t.name ILIKE '%metal%'
    OR t.name ILIKE '%5v%'
    OR t.name ILIKE '%standing seam%'
  )
ON CONFLICT (template_id, document_id) DO NOTHING;