
# Fix: Estimate Names Not Showing in Documents

## Root Cause Analysis

After investigating the database and code:

1. **Database columns exist correctly**: `estimate_display_name` and `estimate_pricing_tier` columns were added to the `documents` table ✓
2. **Code is correctly written**: `saveEstimatePdf` accepts and inserts these values ✓
3. **Call site passes values**: `MultiTemplateSelector.tsx` sends the display name and tier ✓

**The issue**: The documents currently in the database were created **before** the code changes were deployed. The migration added the columns, but the code to populate them wasn't running when those estimates were saved.

| Estimate | In `enhanced_estimates` | In `documents` |
|----------|-------------------------|----------------|
| OBR-00023-8818 | `display_name: "Owens Corning - Reroof"`, `pricing_tier: "better"` | `estimate_display_name: NULL`, `estimate_pricing_tier: NULL` |

---

## Solution: Backfill Existing Documents

Create a database migration to populate the document metadata from existing `enhanced_estimates` records.

### SQL Migration

```sql
-- Backfill estimate metadata from enhanced_estimates to documents
UPDATE documents d
SET 
  estimate_display_name = ee.display_name,
  estimate_pricing_tier = ee.pricing_tier
FROM enhanced_estimates ee
WHERE d.document_type = 'estimate'
  AND d.filename LIKE ee.estimate_number || '%'
  AND d.pipeline_entry_id = ee.pipeline_entry_id
  AND (d.estimate_display_name IS NULL OR d.estimate_pricing_tier IS NULL)
  AND (ee.display_name IS NOT NULL OR ee.pricing_tier IS NOT NULL);
```

This migration:
- Matches documents to estimates using the estimate number in the filename
- Only updates documents where values are currently NULL
- Only pulls from estimates that have values to copy

---

## Files Changed

| File | Change |
|------|--------|
| New migration | Backfill `estimate_display_name` and `estimate_pricing_tier` from `enhanced_estimates` to `documents` |

---

## Future Behavior

After this backfill:
- Existing estimate documents will show their display names and pricing tiers
- New estimates will automatically save this metadata (code already handles this)

---

## Expected Result

**Before fix:**
```
📄 OBR-00023-8818.pdf
   [Estimates]  607.1 KB
```

**After fix:**
```
📄 Owens Corning - Reroof
   [Estimates]  [BETTER]  607.1 KB
   OBR-00023-8818.pdf
```
