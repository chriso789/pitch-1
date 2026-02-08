

# Fix: Bulk Catalog Function - Column Mismatch

## Problem
The error `column "category" of relation "materials" does not exist` occurs because the migration is trying to insert into a non-existent column.

## Root Cause
The `materials` table uses:
- `category_id` (UUID) - a foreign key reference to a categories table

But the migration tries to insert:
- `category` (TEXT) with value `'GENERAL'`

## The Fix
Update the migration function to:
1. **Remove the `category` column** from the INSERT statement
2. Let `category_id` remain NULL (or optionally look up a default category)

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/20260208003850_...sql` | Remove `category` from INSERT, or set `category_id` properly |

## Updated SQL
```sql
-- Remove 'category' column from the INSERT statement
INSERT INTO materials (code, name, uom, base_cost, tenant_id, description)
VALUES (
  v_code,
  v_item.item_name,
  v_item.unit,
  v_item.unit_cost,
  p_tenant_id,
  v_item.description
)
```

The `category_id` will be NULL, which is fine - materials can be uncategorized until the user assigns them to a category.

## Expected Result
After this fix:
1. Clicking "Catalog All (11)" will succeed
2. All 11 items get added to the materials catalog
3. All "Not in catalog" badges disappear
4. Materials are created with `category_id = NULL` (can be categorized later)

