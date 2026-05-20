-- Seed MSFH pipeline stages for O'Brien Contracting tenant (Phase 4)
INSERT INTO public.pipeline_stages (tenant_id, name, key, stage_order, probability_percent, color, is_active, description)
VALUES
  ('14de934e-7964-4afd-940a-620d2ace125d', 'MSFH Contacted',         'msfh_contacted',          200, 10, '#94a3b8', true, 'Homeowner has been contacted via MSFH outbound SMS campaign'),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'MSFH Interested',        'msfh_interested',         210, 30, '#3b82f6', true, 'Homeowner replied with interest in MSFH program guidance'),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'MSFH Inspection Scheduled','msfh_inspection_scheduled',220, 45, '#6366f1', true, 'Free wind mitigation inspection booked'),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'MSFH Inspection Complete','msfh_inspection_complete',230, 60, '#8b5cf6', true, 'Inspection completed, awaiting submission'),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'MSFH Grant Submitted',   'msfh_grant_submitted',    240, 75, '#a855f7', true, 'Grant application submitted to MSFH program'),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'MSFH Approved',          'msfh_approved',           250, 90, '#22c55e', true, 'Grant approved - ready to schedule work'),
  ('14de934e-7964-4afd-940a-620d2ace125d', 'MSFH Roof Closed',       'msfh_roof_closed',        260,100, '#16a34a', true, 'Roof project closed and grant funded')
ON CONFLICT (tenant_id, key) DO NOTHING;