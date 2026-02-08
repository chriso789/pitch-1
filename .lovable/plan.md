

## Plan: Remove Overhead from Templates

### Summary
Remove the `overhead_percentage` column display from the Estimate Templates table and legacy Template Manager. The overhead calculation will be sourced exclusively from the **rep's profile** (`personal_overhead_rate`), which is set under Company Settings → Team Management.

---

## What Changes

### 1. Remove "Overhead" Column from Template List Table
**File**: `src/components/settings/EstimateTemplateList.tsx`

- Remove "Overhead" column header from the table
- Remove the `{template.overhead_percentage}%` cell display
- Remove the column from loading skeletons

**Lines affected**: ~346, 359, ~395-396, 416

### 2. Remove Overhead from Legacy TemplateManager
**File**: `src/components/templates/TemplateManager.tsx`

- Remove "Overhead Percentage" input field from the create template dialog
- Remove overhead display from template cards
- Clean up the `overhead` object from the form state

**Lines affected**: ~309-320 (form input), ~364 (card display), ~47-65 (form state)

---

## No Database Changes Required

The `overhead_percentage` column will remain in the database for backward compatibility, but:
- The UI will no longer display or edit it
- The estimate calculation engine already uses the **rep's `personal_overhead_rate`** as the source of truth (per existing logic in `ProfitCenterPanel.tsx` and `EstimateHyperlinkBar.tsx`)

---

## How Overhead Works After This Change

| Source | Field | Usage |
|--------|-------|-------|
| Rep's Profile | `personal_overhead_rate` | Primary source (set in Team Management) |
| Rep's Profile | `overhead_rate` | Fallback if personal rate is 0 |
| Default | 10% | Final fallback if neither is set |

This follows the existing hierarchy documented in the codebase:
```
effectiveOverheadRate = personal_overhead_rate > 0 ? personal_overhead_rate : (overhead_rate ?? 10)
```

---

## Visual Changes

### Before (Template List)
| Template Name | Type | Category | Items | Overhead | Profit | Status |
|---------------|------|----------|-------|----------|--------|--------|
| GAF Timberline | Shingle | Premium | 19 | 15% | 30% | Active |

### After (Template List)
| Template Name | Type | Category | Items | Profit | Status |
|---------------|------|----------|-------|--------|--------|
| GAF Timberline | Shingle | Premium | 19 | 30% | Active |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/settings/EstimateTemplateList.tsx` | Remove Overhead column from table header, body, and skeleton |
| `src/components/templates/TemplateManager.tsx` | Remove Overhead input and display from legacy manager |

---

## Testing

After implementation:
1. Navigate to Settings → Estimates tab
2. Verify the template list no longer shows an "Overhead" column
3. Create a new estimate and verify overhead is pulled from the rep's profile settings
4. Check that the Profit Center still calculates overhead correctly from the rep's rate

