
# Plan: Fix Estimate Calculations to Use Assigned Rep's Actual Commission & Overhead Rates

## Problem Summary

The estimate pricing system uses hardcoded default rates (10% overhead, 8% commission) instead of the actual assigned sales rep's personalized rates from their profile. The screenshot shows "Test Rep" has 5% overhead and 60% commission (Profit Split), but estimates are being calculated with incorrect rates.

## Root Causes Identified

| Issue | Location | Impact |
|-------|----------|--------|
| Missing `personal_overhead_rate` in query | `MultiTemplateSelector.tsx` line 203 | Falls back to wrong overhead |
| Overhead hierarchy not applied | `MultiTemplateSelector.tsx` line 219 | Uses base `overhead_rate` instead of personal |
| Config initialization timing | `useEstimatePricing.ts` line 69-72 | Defaults applied before rep data arrives |
| Edge function uses default config | `update-estimate-line-items/index.ts` | Ignores rep-specific rates on save |
| Secondary rep logic incomplete | Multiple files | Doesn't handle secondary rep commission deduction before primary split |

## User Requirements (Clarified)

1. **Overhead Calculation**: Use the commission-split rep's overhead percentage
2. **Secondary Rep (Selling Price Commission)**: Their commission is deducted from total profit BEFORE the profit-split rep's percentage is calculated
3. **Two Profit-Split Reps**: Can only split if they have the SAME overhead percentages
4. **Auto-Sync**: When assigned rep changes, all estimates automatically recalculate with new rep's rates

---

## Technical Solution

### Fix 1: Update MultiTemplateSelector to Fetch and Apply Personal Overhead Rate

**File:** `src/components/estimates/MultiTemplateSelector.tsx`

The existing query (lines 196-209) fetches both `overhead_rate` and `commission_structure`, but needs to also fetch `personal_overhead_rate` and apply the correct hierarchy.

**Changes:**
1. Add `personal_overhead_rate` to the profile select query
2. Apply the hierarchy: `personal_overhead_rate > 0` ? use it : use `overhead_rate`
3. Pass correct rates to `setConfig`

```typescript
// Query update (around line 198-206)
.select(`
  assigned_to,
  profiles!pipeline_entries_assigned_to_fkey(
    first_name,
    last_name,
    overhead_rate,
    personal_overhead_rate,  // ADD THIS
    commission_rate,
    commission_structure
  )
`)

// Rate application (around line 216-230)
const profile = data?.profiles as any;
if (profile) {
  // Apply overhead hierarchy: personal_overhead_rate > 0 takes priority
  const personalOverhead = profile.personal_overhead_rate ?? 0;
  const baseOverhead = profile.overhead_rate ?? 10;
  const effectiveOverheadPercent = personalOverhead > 0 ? personalOverhead : baseOverhead;
  
  const rates = {
    overheadPercent: effectiveOverheadPercent,
    commissionPercent: profile.commission_rate ?? 50,
    commissionStructure: (profile.commission_structure === 'sales_percentage' 
      ? 'sales_percentage' 
      : 'profit_split') as 'profit_split' | 'sales_percentage',
    repName: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Rep'
  };
  setRepRates(rates);
  
  // Apply to pricing config
  setConfig({
    overheadPercent: rates.overheadPercent,
    repCommissionPercent: rates.commissionPercent,
    commissionStructure: rates.commissionStructure,
  });
}
```

### Fix 2: Update ProfitCenterPanel to Use Personal Overhead Rate

**File:** `src/components/estimates/ProfitCenterPanel.tsx`

The ProfitCenterPanel already fetches `personal_overhead_rate` (line 75), but the overhead calculation logic (lines 130-132) should be verified to correctly apply the hierarchy.

**Changes:**
The current logic is correct (lines 130-132):
```typescript
const personalOverhead = salesRepData?.personal_overhead_rate ?? 0;
const baseOverhead = (salesRepData as any)?.overhead_rate ?? 10;
const overheadRate = personalOverhead > 0 ? personalOverhead : baseOverhead;
```

No changes needed here - just ensure this pattern is replicated everywhere.

### Fix 3: Update EstimateHyperlinkBar to Use Personal Overhead Rate

**File:** `src/components/estimates/EstimateHyperlinkBar.tsx`

The current query (lines 102-105) fetches both rates but needs to apply the hierarchy correctly.

**Changes:**
Add `personal_overhead_rate` to the query and apply the same hierarchy logic:

```typescript
// Query already correct (lines 102-105), but add personal_overhead_rate if missing
.select('assigned_to, profiles!pipeline_entries_assigned_to_fkey(overhead_rate, personal_overhead_rate)')

// Apply hierarchy (around line 108-112)
const profile = data?.profiles as { overhead_rate: number | null; personal_overhead_rate: number | null } | null;
const personal = profile?.personal_overhead_rate ?? 0;
const base = profile?.overhead_rate ?? 10;
return personal > 0 ? personal : base;
```

### Fix 4: Update Edge Function to Use Rep-Specific Rates

**File:** `supabase/functions/update-estimate-line-items/index.ts`

When line items are saved, the edge function should fetch and apply the assigned rep's rates rather than using defaults.

**Changes:**

Add a query to fetch the assigned rep's rates from the pipeline entry (around line 95-125):

```typescript
// After line 119 (tenant validation), add:

// Fetch assigned rep's overhead and commission rates
const pipelineEntryId = estimate.pipeline_entry_id;
let repOverheadRate = config.overheadPercent || 10;
let repCommissionRate = config.repCommissionPercent || 5;
let commissionStructure = 'profit_split';

if (pipelineEntryId) {
  const { data: pipelineData } = await serviceClient
    .from('pipeline_entries')
    .select(`
      assigned_to,
      profiles!pipeline_entries_assigned_to_fkey(
        overhead_rate,
        personal_overhead_rate,
        commission_rate,
        commission_structure
      )
    `)
    .eq('id', pipelineEntryId)
    .single();
  
  if (pipelineData?.profiles) {
    const profile = pipelineData.profiles as any;
    const personalOverhead = profile.personal_overhead_rate ?? 0;
    const baseOverhead = profile.overhead_rate ?? 10;
    repOverheadRate = personalOverhead > 0 ? personalOverhead : baseOverhead;
    repCommissionRate = profile.commission_rate ?? 50;
    commissionStructure = profile.commission_structure || 'profit_split';
  }
}

// Use these rates in calculations below
const overheadPercent = repOverheadRate;
const overheadAmount = finalSellingPrice * (overheadPercent / 100);

// Calculate commission based on structure
let repCommissionAmount: number;
if (commissionStructure === 'profit_split') {
  const netProfit = finalSellingPrice - directCost - overheadAmount;
  repCommissionAmount = Math.max(0, netProfit * (repCommissionRate / 100));
} else {
  repCommissionAmount = finalSellingPrice * (repCommissionRate / 100);
}
```

### Fix 5: Update RepProfitBreakdown for Secondary Rep Commission Deduction

**File:** `src/components/estimates/RepProfitBreakdown.tsx`

When a secondary rep with `sales_percentage` (Percent of Contract) commission is assigned, their commission should be deducted from gross profit BEFORE calculating the primary rep's profit split.

**Changes:**

Update the commission calculation logic (around lines 117-155):

```typescript
// Calculate commissions with proper ordering
// Step 1: Calculate gross profit (before any commissions)
const totalCost = materialCost + laborCost;
const grossProfit = sellingPrice - totalCost;

// Step 2: Deduct company overhead (from primary/profit-split rep)
const overheadAmount = sellingPrice * (primaryOverheadRate / 100);
const profitAfterOverhead = grossProfit - overheadAmount;

// Step 3: If secondary rep is "sales_percentage" type, deduct their commission first
let profitAfterSecondary = profitAfterOverhead;
let secondaryRepCommission = 0;

if (hasSecondaryRep && secondaryCommissionStructure === 'percentage_contract_price') {
  // Secondary rep takes percentage of selling price (deducted before profit split)
  secondaryRepCommission = sellingPrice * (secondaryCommissionRate / 100);
  profitAfterSecondary = profitAfterOverhead - secondaryRepCommission;
}

// Step 4: Primary (profit-split) rep takes their percentage of remaining profit
let primaryRepCommission = 0;
if (primaryCommissionStructure === 'profit_split') {
  primaryRepCommission = Math.max(0, profitAfterSecondary * (primaryCommissionRate / 100));
} else {
  primaryRepCommission = sellingPrice * (primaryCommissionRate / 100);
}

// Step 5: Apply split percentages if both reps are profit-split with same overhead
// (User requirement: two profit-split reps can only split if same overhead %)
if (hasSecondaryRep && 
    secondaryCommissionStructure === 'profit_split' && 
    primaryOverheadRate === secondaryOverheadRate) {
  // Both are profit-split with same overhead - apply split percentages
  const totalProfitSplitCommission = profitAfterSecondary * (primaryCommissionRate / 100);
  primaryRepCommission = (totalProfitSplitCommission * primarySplitPercent) / 100;
  secondaryRepCommission = (totalProfitSplitCommission * secondarySplitPercent) / 100;
}

const totalRepCommission = primaryRepCommission + secondaryRepCommission;
const companyNet = profitAfterSecondary - totalRepCommission;
```

### Fix 6: Update useEstimatePricing Hook to Accept Initial Config Properly

**File:** `src/hooks/useEstimatePricing.ts`

The hook already has a `useEffect` to update config when `initialConfig` changes (lines 76-80), but the dependency array only checks specific properties. This should be more robust.

**Changes:**

Update the useEffect to properly sync when initialConfig updates (around lines 76-80):

```typescript
// Update config when initialConfig changes (e.g., when rep rates are fetched)
useEffect(() => {
  if (initialConfig) {
    setConfigState(current => ({
      ...current,
      overheadPercent: initialConfig.overheadPercent ?? current.overheadPercent,
      repCommissionPercent: initialConfig.repCommissionPercent ?? current.repCommissionPercent,
      commissionStructure: initialConfig.commissionStructure ?? current.commissionStructure,
    }));
  }
}, [
  initialConfig?.overheadPercent, 
  initialConfig?.repCommissionPercent, 
  initialConfig?.commissionStructure
]);
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/MultiTemplateSelector.tsx` | Add `personal_overhead_rate` to query, apply overhead hierarchy |
| `src/components/estimates/EstimateHyperlinkBar.tsx` | Verify overhead hierarchy is applied correctly |
| `src/components/estimates/RepProfitBreakdown.tsx` | Update secondary rep commission deduction logic |
| `supabase/functions/update-estimate-line-items/index.ts` | Fetch assigned rep's rates and use in calculations |
| `src/hooks/useEstimatePricing.ts` | Ensure config syncs when initialConfig updates |

---

## Expected Results

After these changes:
1. **Test Rep (5% overhead, 60% profit split)** will see estimates calculated with their actual rates
2. Secondary reps with "Percent of Contract" commission will have their commission deducted BEFORE the primary rep's profit split is calculated
3. When a project's assigned rep changes, all estimate calculations will auto-update to the new rep's rates
4. The Profit Center panel will accurately reflect each rep's personalized rates

---

## Technical Notes

1. **Overhead Hierarchy**: `personal_overhead_rate > 0` takes precedence over `overhead_rate` (company default)
2. **Commission Types**:
   - `profit_split` (Net Profit Split): Commission = Net Profit × Rate %
   - `sales_percentage` (Percent of Contract): Commission = Selling Price × Rate %
3. **Secondary Rep Deduction Order**: Secondary rep's "Percent of Contract" commission is deducted from gross profit BEFORE the primary rep's profit split is calculated
4. **Two Profit-Split Reps**: Only allowed to split if they have the same overhead percentage
