

# Plan: Fix Line Item Cost Not Saving + Remove Duplicate Materials

## Issue 1: Cost Not Saving When Selecting From Autocomplete

**Root Cause**: In `MaterialAutocomplete.tsx`, the `handleSelect` function calls both `onSelectMaterial(material)` and then `onChange(material.name)`. In the parent (`SectionedLineItemsTable.tsx`), both callbacks call `onNewItemChange(setNewItem)` — but the `onChange` callback uses a **stale closure** over `newItem`, so it overwrites the `unit_cost` that was just set by `onSelectMaterial`.

```
handleSelect → onSelectMaterial({...newItem, unit_cost: 65}) → state queued
            → onChange(name) → ({...newItem, item_name: name}) → overwrites with stale newItem (unit_cost: 0)
```

**Fix in `MaterialAutocomplete.tsx`**: Remove the `onChange(material.name)` call from `handleSelect`. The `onSelectMaterial` callback already sets `item_name` to `material.name` in all three call sites in `SectionedLineItemsTable.tsx`, so the separate `onChange` call is redundant and harmful.

```typescript
// MaterialAutocomplete.tsx line 125-128
const handleSelect = (material: Material) => {
  onSelectMaterial(material);
  // Remove: onChange(material.name);  ← this overwrites with stale state
  setShowDropdown(false);
};
```

## Issue 2: Duplicate Material in Catalog

**Root Cause**: Two identical "2 3/8\" Decking Nails" entries exist in the `materials` table for the same tenant:
- `3618bd41` — code `CUSTOM-1769130791231`
- `35aede07` — code `CUSTOM-1769570979591`

**Fix**: SQL migration to delete the newer duplicate and add a unique constraint to prevent future duplicates.

```sql
-- Delete the duplicate (keep the older one by code timestamp)
DELETE FROM materials WHERE id = '35aede07-30f6-4a28-91b7-51ae590eb8ae';

-- Add unique constraint: same tenant cannot have two materials with the same name
CREATE UNIQUE INDEX IF NOT EXISTS materials_tenant_name_unique 
ON materials (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), LOWER(name));
```

The unique index uses `COALESCE` on `tenant_id` (matching the existing pattern in this project) and `LOWER(name)` to prevent case-insensitive duplicates.

## Summary
1. **`MaterialAutocomplete.tsx`**: Remove `onChange(material.name)` from `handleSelect` — fixes cost not persisting
2. **SQL migration**: Delete duplicate material + add unique constraint on `(tenant_id, name)`

