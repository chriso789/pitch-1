

# Plan: Fix Commission Rate Sync and Structure Mapping

## Summary

There are two issues preventing the 60% commission from showing:

1. **Database is stale**: The edge function was just deployed but hasn't been called. The `profiles.commission_rate` is still 50.00 for Test Rep.
2. **Structure mapping mismatch**: The `MultiTemplateSelector.tsx` expects `sales_percentage` but the edge function saves `percentage_contract_price`.

---

## Issue 1: Stale Database Value

**Current state**:
- `profiles.commission_rate` = 50.00
- `profiles.commission_structure` = profit_split

**Action required**:
The edge function is now deployed with the fix. The user must **re-save Test Rep's commission settings** (Settings → Users → Commission Settings) to trigger the sync and update the profile.

Alternatively, run this SQL to immediately update the database:

```sql
UPDATE profiles 
SET commission_rate = 60, commission_structure = 'profit_split'
WHERE id = '3a45549d-e107-4ea0-9a16-c69e5fd6056f';
```

---

## Issue 2: Commission Structure Type Mismatch

### Root Cause

The application uses inconsistent type names for commission structure:

| Location | Profit Split | Contract Percentage |
|----------|--------------|---------------------|
| Edge function saves | `profit_split` | `percentage_contract_price` |
| MultiTemplateSelector expects | `profit_split` | `sales_percentage` |
| RepProfitBreakdown expects | `profit_split` | `percentage_contract_price` |
| useEstimatePricing uses | `profit_split` | `sales_percentage` |
| Database enum | `profit_split` | `sales_percentage` |

### Problem Code

In `MultiTemplateSelector.tsx` line 227:
```typescript
commissionStructure: (profile.commission_structure === 'sales_percentage' 
  ? 'sales_percentage' 
  : 'profit_split')
```

This checks for `sales_percentage`, but the edge function saves `percentage_contract_price`, so it always defaults to `profit_split`.

### Solution

Update `MultiTemplateSelector.tsx` to normalize both possible values:

```typescript
// Accept both 'percentage_contract_price' (from edge function) and 'sales_percentage' (from DB enum)
commissionStructure: (
  profile.commission_structure === 'sales_percentage' || 
  profile.commission_structure === 'percentage_contract_price'
) ? 'sales_percentage' : 'profit_split'
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/MultiTemplateSelector.tsx` | Normalize commission structure type to accept both `percentage_contract_price` and `sales_percentage` |

---

## Technical Details

### MultiTemplateSelector.tsx Changes (line 227)

Current:
```typescript
commissionStructure: (profile.commission_structure === 'sales_percentage' ? 'sales_percentage' : 'profit_split') as 'profit_split' | 'sales_percentage',
```

Updated:
```typescript
commissionStructure: (profile.commission_structure === 'sales_percentage' || profile.commission_structure === 'percentage_contract_price') ? 'sales_percentage' : 'profit_split',
```

---

## Testing Steps

1. **Immediate fix**: Re-save Test Rep's commission settings in Settings → Users → Commission Settings
2. **Verify**: Navigate to an estimate assigned to Test Rep
3. **Expected result**: Commission should show 60% profit split

---

## Expected Results

After re-saving commission settings and applying the code fix:

1. New estimates will show the correct 60% commission rate
2. Commission structure type (`percentage_contract_price`) will be correctly mapped to `sales_percentage` for the pricing hook
3. The estimate builder and profit breakdown will display accurate calculations

