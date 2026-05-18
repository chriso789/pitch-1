
-- Copy pipeline + production configuration from O'Brien Contracting to GSD Construction
DO $$
DECLARE
  src uuid := '14de934e-7964-4afd-940a-620d2ace125d'; -- O'Brien
  dst uuid := '4f5b1865-6cbb-47d2-b75a-c0b5ce92003c'; -- GSD
BEGIN
  -- 1. Pipeline stages
  INSERT INTO public.pipeline_stages (
    tenant_id, name, description, stage_order, probability_percent, is_active, color,
    auto_actions, key, is_terminal, auto_close_days, is_conversion_point,
    archive_on_entry, archive_after_days
  )
  SELECT dst, name, description, stage_order, probability_percent, is_active, color,
         auto_actions, key, is_terminal, auto_close_days, is_conversion_point,
         archive_on_entry, archive_after_days
  FROM public.pipeline_stages
  WHERE tenant_id = src
    AND NOT EXISTS (
      SELECT 1 FROM public.pipeline_stages d
      WHERE d.tenant_id = dst AND d.key = public.pipeline_stages.key
    );

  -- 2. Contact statuses (dispositions)
  INSERT INTO public.contact_statuses (
    tenant_id, name, key, description, color, category, status_order, is_active, is_system
  )
  SELECT dst, name, key, description, color, category, status_order, is_active, is_system
  FROM public.contact_statuses
  WHERE tenant_id = src
    AND NOT EXISTS (
      SELECT 1 FROM public.contact_statuses d
      WHERE d.tenant_id = dst AND d.key = public.contact_statuses.key
    );

  -- 3. Production stages (used for Production kanban + gates)
  INSERT INTO public.production_stages (
    tenant_id, name, stage_key, sort_order, color, icon, is_active,
    gate_requirements, gate_documents_required, min_photos_required,
    requires_noc, requires_permit, requires_material_order
  )
  SELECT dst, name, stage_key, sort_order, color, icon, is_active,
         gate_requirements, gate_documents_required, min_photos_required,
         requires_noc, requires_permit, requires_material_order
  FROM public.production_stages
  WHERE tenant_id = src
    AND NOT EXISTS (
      SELECT 1 FROM public.production_stages d
      WHERE d.tenant_id = dst AND d.stage_key = public.production_stages.stage_key
    );

  -- 4. Production checklist stages (tenant-default, no location)
  INSERT INTO public.production_checklist_stages (
    tenant_id, location_id, stage_key, name, color, icon, sort_order
  )
  SELECT dst, NULL, stage_key, name, color, icon, sort_order
  FROM public.production_checklist_stages
  WHERE tenant_id = src AND location_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.production_checklist_stages d
      WHERE d.tenant_id = dst AND d.location_id IS NULL
        AND d.stage_key = public.production_checklist_stages.stage_key
    );

  -- 5. Production checklist templates (the actual checklist items per stage)
  INSERT INTO public.production_checklist_templates (
    tenant_id, location_id, stage_key, item_label, item_description,
    is_required, sort_order, trade_type
  )
  SELECT dst, NULL, stage_key, item_label, item_description,
         is_required, sort_order, trade_type
  FROM public.production_checklist_templates
  WHERE tenant_id = src AND location_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.production_checklist_templates d
      WHERE d.tenant_id = dst AND d.location_id IS NULL
        AND d.stage_key = public.production_checklist_templates.stage_key
        AND d.item_label = public.production_checklist_templates.item_label
    );
END $$;
