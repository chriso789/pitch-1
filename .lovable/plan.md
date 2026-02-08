

# Plan: Bulk Catalog All Template Items

## Problem
Your template shows 11 items with "Not in catalog" badges because:
- These items were created before the catalog linking feature was added
- The only current option is to click "Save to Catalog" on each item individually

## Solution
Add a **"Catalog All Items"** button to the template editor that:
1. Scans all material items without a `material_id`
2. Creates them in the materials catalog (tenant-scoped)
3. Links them back to the template items
4. Removes all "Not in catalog" badges in one click

---

## What Will Be Built

### 1. "Catalog All" Button in Header
**Location**: Template Editor header (next to "Add Group" button)

- Only shows when there are uncataloged items
- Shows count: "Catalog All (11 items)"
- One-click to sync everything

### 2. Bulk Sync Database Function
**New Function**: `api_bulk_sync_template_items_to_catalog`

- Accepts `template_id` and `tenant_id`
- Finds all items where `material_id IS NULL` and `item_type = 'material'`
- Creates materials in the catalog with proper tenant scoping
- Links back to template items
- Returns count of items processed

### 3. Frontend Hook Enhancement
**File**: `src/components/templates/hooks/useCalcTemplateEditor.ts`

- Add `catalogAllItems()` function
- Calls the bulk RPC
- Updates local state to refresh all badges

---

## Technical Implementation

### Database Migration
```sql
CREATE OR REPLACE FUNCTION api_bulk_sync_template_items_to_catalog(
  p_template_id UUID,
  p_tenant_id UUID
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_item RECORD;
  v_material_id UUID;
BEGIN
  FOR v_item IN 
    SELECT * FROM estimate_calc_template_items 
    WHERE calc_template_id = p_template_id 
      AND item_type = 'material'
      AND material_id IS NULL
  LOOP
    -- Create or update material in catalog
    INSERT INTO materials (code, name, uom, base_cost, tenant_id, description)
    VALUES (
      COALESCE(v_item.sku_pattern, LOWER(REPLACE(v_item.item_name, ' ', '-'))),
      v_item.item_name,
      v_item.unit,
      v_item.unit_cost,
      p_tenant_id,
      v_item.description
    )
    ON CONFLICT (code, COALESCE(tenant_id, '00000000-...')) DO UPDATE SET
      base_cost = EXCLUDED.base_cost,
      updated_at = NOW()
    RETURNING id INTO v_material_id;
    
    -- Link template item
    UPDATE estimate_calc_template_items 
    SET material_id = v_material_id
    WHERE id = v_item.id;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Frontend Changes

**File**: `src/components/templates/hooks/useCalcTemplateEditor.ts`
- Add `catalogAllItems()` function that calls the RPC
- Update local state to set `material_id` on all synced items

**File**: `src/components/templates/CalcTemplateEditor.tsx`
- Add button in header showing uncataloged count
- Call `catalogAllItems()` on click
- Refresh the template after sync

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/[timestamp]_bulk_catalog_sync.sql` | Create bulk sync function |
| `src/components/templates/hooks/useCalcTemplateEditor.ts` | Add `catalogAllItems()` |
| `src/components/templates/CalcTemplateEditor.tsx` | Add "Catalog All" button |

---

## Visual Preview

**Before**: 
```
[Back] Template Name         [Add Group] [Save Template]
```

**After**:
```
[Back] Template Name         [Catalog All (11)] [Add Group] [Save Template]
```

---

## Expected Result

After clicking "Catalog All (11)":
1. All 11 items are added to your company's material catalog
2. All "Not in catalog" badges disappear immediately
3. Toast confirms: "11 items added to company catalog"
4. These materials are now available for other templates

