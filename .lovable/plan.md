

# Fix Labor Section Filter in Material Catalog

## Problem
The Material Catalog has a "Labor" section filter in the dropdown, but selecting it shows "No materials found." This is because the 74 labor items are in the `Labor` category which has `section = 'roof'` in the `material_categories` table. The section filter looks for `section = 'labor'`, which no category has.

## Fix

### Update the Labor category's section in the database (migration)
Change the `material_categories` row where `name = 'Labor'` from `section = 'roof'` to `section = 'labor'`.

```sql
UPDATE material_categories SET section = 'labor' WHERE name = 'Labor';
```

This single change will make all 74 labor materials appear when the user selects the "Labor" section filter, while still appearing under "All Sections."

## Files Changed

| File | Change |
|------|--------|
| New migration | Update `material_categories` Labor row to `section = 'labor'` |

