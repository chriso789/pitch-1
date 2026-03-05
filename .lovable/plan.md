

# Fix: Saved Estimates Not Showing — Missing Foreign Key

## Root Cause

The query in `SavedEstimatesList.tsx` (line 125) uses a PostgREST relational embed:
```
profiles!enhanced_estimates_created_by_fkey(first_name, last_name)
```

But **no foreign key named `enhanced_estimates_created_by_fkey` exists** on the `enhanced_estimates` table. The actual FK constraints are only for `labor_cost_locked_by`, `material_cost_locked_by`, `measurement_report_id`, `signature_envelope_id`, `template_id`, and `tenant_id`.

When PostgREST encounters a reference to a non-existent FK hint, the query **fails with an error**, which is caught by the `if (error) throw error` line. React Query then treats this as a failed query, so `estimates` remains undefined, and the component renders nothing (`return null` on line 358).

The estimate data IS in the database (confirmed: `OBR-00038-zlvg`, $16,000, pipeline_entry_id matches) — it's purely a query failure.

## Fix (2 changes)

### 1. Database Migration: Add missing FK constraint
```sql
ALTER TABLE public.enhanced_estimates
ADD CONSTRAINT enhanced_estimates_created_by_fkey
FOREIGN KEY (created_by) REFERENCES public.profiles(id);
```
This makes the PostgREST relational embed `profiles!enhanced_estimates_created_by_fkey(...)` valid.

### 2. Defensive query fallback in `SavedEstimatesList.tsx`
Even with the FK added, make the query resilient by catching the join failure and falling back gracefully. If the profiles join fails for any reason, the estimates should still display — just without the "Created by" attribution.

In the `queryFn` (line 109-137): wrap the profiles join in a try/catch, or use a two-query approach where the main estimate query doesn't include the profiles join, and a secondary query fetches creator names separately.

**Recommended approach**: Keep the relational embed (it's cleaner) but add the FK so it works. No code change needed beyond the migration.

## Files Changed
- **SQL Migration**: Add `enhanced_estimates_created_by_fkey` foreign key
- **`src/components/estimates/SavedEstimatesList.tsx`**: No change needed if FK is added; optionally add error logging for debugging

