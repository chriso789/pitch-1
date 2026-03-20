
-- Backfill line item descriptions from materials table (one-time data migration)
DO $$
DECLARE
  r RECORD;
  new_materials jsonb;
  new_labor jsonb;
  elem jsonb;
  mat_desc text;
  changed boolean;
  update_count integer := 0;
BEGIN
  FOR r IN SELECT id, tenant_id, line_items FROM enhanced_estimates WHERE line_items IS NOT NULL
  LOOP
    changed := false;
    
    -- Process materials array
    IF r.line_items ? 'materials' AND jsonb_array_length(r.line_items->'materials') > 0 THEN
      new_materials := '[]'::jsonb;
      FOR elem IN SELECT * FROM jsonb_array_elements(r.line_items->'materials')
      LOOP
        IF (elem->>'description') IS NULL OR (elem->>'description') = '' THEN
          SELECT m.description INTO mat_desc 
          FROM materials m 
          WHERE lower(trim(m.name)) = lower(trim(elem->>'item_name')) 
            AND m.tenant_id = r.tenant_id 
          LIMIT 1;
          
          IF mat_desc IS NOT NULL AND mat_desc != '' THEN
            elem := elem || jsonb_build_object('description', mat_desc);
            changed := true;
          END IF;
        END IF;
        new_materials := new_materials || jsonb_build_array(elem);
      END LOOP;
    ELSE
      new_materials := COALESCE(r.line_items->'materials', '[]'::jsonb);
    END IF;
    
    -- Process labor array
    IF r.line_items ? 'labor' AND jsonb_array_length(r.line_items->'labor') > 0 THEN
      new_labor := '[]'::jsonb;
      FOR elem IN SELECT * FROM jsonb_array_elements(r.line_items->'labor')
      LOOP
        IF (elem->>'description') IS NULL OR (elem->>'description') = '' THEN
          SELECT m.description INTO mat_desc 
          FROM materials m 
          WHERE lower(trim(m.name)) = lower(trim(elem->>'item_name')) 
            AND m.tenant_id = r.tenant_id 
          LIMIT 1;
          
          IF mat_desc IS NOT NULL AND mat_desc != '' THEN
            elem := elem || jsonb_build_object('description', mat_desc);
            changed := true;
          END IF;
        END IF;
        new_labor := new_labor || jsonb_build_array(elem);
      END LOOP;
    ELSE
      new_labor := COALESCE(r.line_items->'labor', '[]'::jsonb);
    END IF;
    
    IF changed THEN
      UPDATE enhanced_estimates 
      SET line_items = jsonb_set(jsonb_set(line_items, '{materials}', new_materials), '{labor}', new_labor)
      WHERE id = r.id;
      update_count := update_count + 1;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Updated % estimates with descriptions from materials table', update_count;
END $$;
