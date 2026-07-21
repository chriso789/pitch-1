
CREATE OR REPLACE FUNCTION public.autolink_template_item_to_material()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_material_id UUID;
  v_code TEXT;
BEGIN
  IF NEW.item_type IS DISTINCT FROM 'material' OR NEW.material_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.estimate_calculation_templates
  WHERE id = NEW.calc_template_id;

  IF v_tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Match by case-insensitive name within the same tenant
  SELECT id INTO v_material_id
  FROM public.materials
  WHERE tenant_id = v_tenant_id
    AND lower(name) = lower(COALESCE(NEW.item_name, ''))
  LIMIT 1;

  -- Fallback: match by code (sku_pattern or name slug)
  IF v_material_id IS NULL THEN
    v_code := COALESCE(
      NULLIF(NEW.sku_pattern, ''),
      LOWER(REGEXP_REPLACE(COALESCE(NEW.item_name,''), '[^a-zA-Z0-9]+', '-', 'g'))
    );
    SELECT id INTO v_material_id
    FROM public.materials
    WHERE tenant_id = v_tenant_id
      AND code = v_code
    LIMIT 1;
  END IF;

  IF v_material_id IS NOT NULL THEN
    NEW.material_id := v_material_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autolink_template_item_to_material ON public.estimate_calc_template_items;
CREATE TRIGGER trg_autolink_template_item_to_material
BEFORE INSERT ON public.estimate_calc_template_items
FOR EACH ROW
EXECUTE FUNCTION public.autolink_template_item_to_material();
