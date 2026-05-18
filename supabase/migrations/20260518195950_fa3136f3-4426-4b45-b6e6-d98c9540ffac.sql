
DO $$
DECLARE
  src uuid := '14de934e-7964-4afd-940a-620d2ace125d';
  dst uuid := '4f5b1865-6cbb-47d2-b75a-c0b5ce92003c';
BEGIN
  -- Checklist stages (dedupe by stage_key, take lowest sort_order per key)
  INSERT INTO public.production_checklist_stages (tenant_id, location_id, stage_key, name, color, icon, sort_order)
  SELECT dst, NULL, stage_key, name, color, icon, sort_order
  FROM (
    SELECT DISTINCT ON (stage_key) stage_key, name, color, icon, sort_order
    FROM public.production_checklist_stages
    WHERE tenant_id = src
    ORDER BY stage_key, sort_order
  ) s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.production_checklist_stages d
    WHERE d.tenant_id = dst AND d.location_id IS NULL AND d.stage_key = s.stage_key
  );

  -- Checklist templates (dedupe by stage_key + item_label across O'Brien locations)
  INSERT INTO public.production_checklist_templates (
    tenant_id, location_id, stage_key, item_label, item_description, is_required, sort_order, trade_type
  )
  SELECT dst, NULL, stage_key, item_label, item_description, is_required, sort_order, trade_type
  FROM (
    SELECT DISTINCT ON (stage_key, item_label)
           stage_key, item_label, item_description, is_required, sort_order, trade_type
    FROM public.production_checklist_templates
    WHERE tenant_id = src
    ORDER BY stage_key, item_label, sort_order
  ) s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.production_checklist_templates d
    WHERE d.tenant_id = dst AND d.location_id IS NULL
      AND d.stage_key = s.stage_key AND d.item_label = s.item_label
  );
END $$;
