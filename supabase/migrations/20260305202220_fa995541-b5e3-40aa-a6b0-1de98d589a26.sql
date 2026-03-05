INSERT INTO enhanced_estimates (
  pipeline_entry_id, tenant_id, estimate_number, display_name,
  pricing_tier, selling_price, status, pdf_url, created_at, created_by,
  customer_name, customer_address, roof_area_sq_ft, roof_pitch,
  material_cost, material_total, labor_cost, labor_total,
  overhead_percent, overhead_amount, subtotal,
  target_profit_percent, actual_profit_percent,
  line_items
)
VALUES
(
  '3ffe4e61-58ff-45b0-9925-540a14aa994b',
  '14de934e-7964-4afd-940a-620d2ace125d',
  'OBR-00038-38e0',
  'Paver System',
  'better',
  0,
  'draft',
  '3ffe4e61-58ff-45b0-9925-540a14aa994b/estimates/OBR-00038-38e0.pdf',
  '2026-03-05 18:07:45.300778+00',
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9',
  '', '', 0, '4/12',
  0, 0, 0, 0,
  20, 0, 0,
  30, 0,
  '[]'::jsonb
),
(
  '3ffe4e61-58ff-45b0-9925-540a14aa994b',
  '14de934e-7964-4afd-940a-620d2ace125d',
  'OBR-00038-z85r',
  'Paver System',
  'better',
  0,
  'draft',
  '3ffe4e61-58ff-45b0-9925-540a14aa994b/estimates/OBR-00038-z85r.pdf',
  '2026-03-05 18:04:38.336086+00',
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9',
  '', '', 0, '4/12',
  0, 0, 0, 0,
  20, 0, 0,
  30, 0,
  '[]'::jsonb
);