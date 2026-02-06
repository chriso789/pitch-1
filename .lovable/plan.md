
# Plan: Fix Estimate Switching Not Loading New Template

## Problem Identified

When you're editing one estimate and click "Edit" on a different saved estimate, the template area doesn't update. The second estimate never loads.

**Root Cause (Line 378 in MultiTemplateSelector.tsx):**
```typescript
if (editEstimateId && !editEstimateProcessed && !existingEstimateId) {
```

The condition `!existingEstimateId` blocks loading a new estimate when another one is already being edited. Once `existingEstimateId` is set (from editing estimate #1), clicking "Edit" on estimate #2 fails because `existingEstimateId !== null`.

---

## Solution

Change the useEffect logic to:
1. Check if the `editEstimateId` from URL is **different** from the currently loaded estimate
2. If so, load the new estimate (replacing the current one)

---

## Technical Changes

### File: `src/components/estimates/MultiTemplateSelector.tsx`

**Lines 375-388 - Update the editEstimate useEffect:**

**Current (Broken):**
```typescript
useEffect(() => {
  const editEstimateId = searchParams.get('editEstimate');
  if (editEstimateId && !editEstimateProcessed && !existingEstimateId) {
    setEditEstimateProcessed(true);
    loadEstimateForEditing(editEstimateId);
    // Clear the URL param after loading
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('editEstimate');
    const newUrl = `${window.location.pathname}?${newParams.toString()}`;
    window.history.replaceState({}, '', newUrl);
  }
}, [searchParams, editEstimateProcessed, existingEstimateId]);
```

**Fixed:**
```typescript
useEffect(() => {
  const editEstimateId = searchParams.get('editEstimate');
  
  // Load if:
  // 1. There's an editEstimate param in URL
  // 2. It's different from what we're currently editing (or nothing is being edited)
  if (editEstimateId && editEstimateId !== existingEstimateId) {
    // Reset previous editing state before loading new estimate
    setEditEstimateProcessed(true);
    setLineItems([]); // Clear old line items
    setFixedPrice(null);
    setEstimateDisplayName('');
    setEstimatePricingTier(null);
    
    loadEstimateForEditing(editEstimateId);
    
    // Clear the URL param after loading
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('editEstimate');
    const newUrl = `${window.location.pathname}?${newParams.toString()}`;
    window.history.replaceState({}, '', newUrl);
  }
}, [searchParams, existingEstimateId]);
```

**Key Changes:**
1. Remove `!editEstimateProcessed` condition - not needed when we check against `existingEstimateId`
2. Change `!existingEstimateId` to `editEstimateId !== existingEstimateId` - allows switching between estimates
3. Reset old state (`lineItems`, `fixedPrice`, `estimateDisplayName`, `estimatePricingTier`) before loading new estimate
4. Remove `editEstimateProcessed` from dependencies since we're not using it in the condition

---

## Result

| Scenario | Before | After |
|----------|--------|-------|
| Click Edit on first estimate | ✅ Loads | ✅ Loads |
| Click Edit on second estimate (while editing first) | ❌ Does nothing | ✅ Switches to second estimate |
| Unsaved changes warning | ✅ Shows dialog | ✅ Still shows (handled by SavedEstimatesList) |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/MultiTemplateSelector.tsx` | Fix the editEstimate URL parameter useEffect (lines 375-388) |
