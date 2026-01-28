
# Plan: Fix Commission Rate Sync Between Settings and Estimates

## Problem Identified

The **"Test Rep" shows 50% commission** in the estimate even though you set 60%, because:

1. **Commission Settings saves to**: `commission_plans.plan_config.commission_rate` (via edge function)
2. **Estimate Builder reads from**: `profiles.commission_rate` (direct column on profiles table)

The `save-commission-settings` edge function **does NOT sync** the `commission_rate` and `commission_structure` to the `profiles` table - it only updates the `commission_plans` table.

## Current Database State for "Test Rep"

| Table | Field | Value |
|-------|-------|-------|
| `profiles` | `commission_rate` | 50.00 (STALE - not being updated) |
| `profiles` | `commission_structure` | profit_split |
| `commission_plans.plan_config` | `commission_rate` | 50 |

When you change the commission to 60%, only `commission_plans` gets updated, but `profiles.commission_rate` stays at 50%.

## Solution

Update the `save-commission-settings` edge function to also update `profiles.commission_rate` and `profiles.commission_structure` when saving commission settings.

---

## Technical Implementation

### File: `supabase/functions/save-commission-settings/index.ts`

**Current Code** (lines 138-152):
```typescript
const profileUpdate: Record<string, unknown> = {
  personal_overhead_rate: rep_overhead_rate
};

if (is_manager) {
  profileUpdate.manager_override_rate = manager_override_rate || 0;
  // ... other manager fields
} else {
  profileUpdate.reports_to_manager_id = reports_to_manager_id || null;
}
```

**Fixed Code**:
```typescript
const profileUpdate: Record<string, unknown> = {
  personal_overhead_rate: rep_overhead_rate,
  // ADD THESE TWO FIELDS to sync with estimate builder:
  commission_rate: commission_rate,
  commission_structure: commission_type, // 'profit_split' or 'percentage_contract_price'
};

if (is_manager) {
  profileUpdate.manager_override_rate = manager_override_rate || 0;
  // ... other manager fields
} else {
  profileUpdate.reports_to_manager_id = reports_to_manager_id || null;
}
```

---

## Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/save-commission-settings/index.ts` | Add `commission_rate` and `commission_structure` to profile update |

---

## Expected Results

1. When you save commission settings (e.g., changing from 50% to 60%), both `commission_plans` AND `profiles` tables will be updated
2. The estimate builder will now show the correct 60% commission rate
3. All existing estimates will use the updated rate from `profiles.commission_rate`

---

## Immediate Fix Option

To fix Test Rep's rate right now (without deploying code), you could run this SQL in Supabase:

```sql
UPDATE profiles 
SET commission_rate = 60, commission_structure = 'profit_split'
WHERE id = '3a45549d-e107-4ea0-9a16-c69e5fd6056f';
```

However, the code fix is required to prevent this sync issue from happening again when commission settings are changed.
