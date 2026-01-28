
# Fix: "Save Changes" Button Error When Editing Estimates

## Problem

When clicking "Save Changes" after editing an estimate, the edge function `update-estimate-line-items` fails with "Edge Function returned a non-2xx status code". The error toast shows "Failed to save line item changes".

---

## Root Cause

There are two JavaScript reference errors in the edge function:

| Line | Bug | Correct Variable |
|------|-----|------------------|
| 223 | `repCommissionPercent` | `repCommissionRate` |
| 233 | `config` | `pricing_config` |

When the edge function tries to access these undefined variables, it throws a reference error and returns a 500 status.

---

## Solution

Fix the two typos in `supabase/functions/update-estimate-line-items/index.ts`:

### Change 1: Line 223
```typescript
// Before (line 223)
rep_commission_percent: repCommissionPercent,

// After
rep_commission_percent: repCommissionRate,
```

### Change 2: Line 233
```typescript
// Before (line 233)
pricing_config: config

// After
pricing_config: pricing_config
```

---

## File to Modify

| File | Change |
|------|--------|
| `supabase/functions/update-estimate-line-items/index.ts` | Fix two undefined variable references: `repCommissionPercent` → `repCommissionRate` and `config` → `pricing_config` |

---

## Expected Result

After fix:
- "Save Changes" button successfully updates the estimate
- All profit/overhead calculations are stored correctly
- The estimate builder closes and resets after successful save
- Toast shows "Changes Saved" success message
