

# Fix: Bulk Catalog ON CONFLICT Mismatch

## Problem
The error `there is no unique or exclusion constraint matching the ON CONFLICT specification` occurs because the bulk sync function uses:

```sql
ON CONFLICT (code, tenant_id) DO UPDATE SET ...
```

But the actual unique index on `materials` is defined as:

```sql
CREATE UNIQUE INDEX materials_code_tenant_unique 
ON public.materials (code, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'));
```

PostgreSQL requires an **exact match** between the `ON CONFLICT` target and the unique index expression. Since the index uses `COALESCE()`, a plain column reference won't work.

---

## The Fix

Use the existing `api_upsert_material` function which already handles this correctly, instead of raw INSERT:

```sql
-- Instead of raw INSERT with ON CONFLICT...
-- Call the existing function that already handles the COALESCE correctly:
SELECT api_upsert_material(
  p_code := v_code,
  p_name := v_item.item_name,
  p_tenant_id := p_tenant_id,
  p_uom := v_item.unit,
  p_base_cost := v_item.unit_cost,
  p_description := v_item.description
) INTO v_material_id;
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/[new]_fix_bulk_catalog_conflict.sql` | Update function to use `api_upsert_material` instead of raw INSERT |

---

## Updated Function

```sql
CREATE OR REPLACE FUNCTION public.api_bulk_sync_template_items_to_catalog(
  p_template_id UUID,
  p_tenant_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_item RECORD;
  v_material_id UUID;
  v_code TEXT;
BEGIN
  FOR v_item IN 
    SELECT * FROM estimate_calc_template_items 
    WHERE calc_template_id = p_template_id 
      AND item_type = 'material'
      AND material_id IS NULL
  LOOP
    v_code := COALESCE(
      NULLIF(v_item.sku_pattern, ''), 
      LOWER(REGEXP_REPLACE(v_item.item_name, '[^a-zA-Z0-9]+', '-', 'g'))
    );
    
    -- Use existing upsert function that handles COALESCE correctly
    SELECT api_upsert_material(
      p_code := v_code,
      p_name := v_item.item_name,
      p_tenant_id := p_tenant_id,
      p_uom := v_item.unit,
      p_base_cost := v_item.unit_cost,
      p_description := v_item.description
    ) INTO v_material_id;
    
    UPDATE estimate_calc_template_items 
    SET material_id = v_material_id
    WHERE id = v_item.id;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;
```

---

## Why This Works

The `api_upsert_material` function (created in a previous migration) already uses the correct `ON CONFLICT` syntax that matches the unique index:

```sql
ON CONFLICT (code, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'))
DO UPDATE SET ...
```

By calling this function instead of raw INSERT, we reuse the existing, tested logic.

---

## Expected Result
After this fix:
1. Click "Catalog All (11)" succeeds
2. All 11 items are added to the materials catalog
3. All "Not in catalog" badges disappear
4. Materials are linked back to template items via `material_id`

