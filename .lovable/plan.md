

# Fix: Edit Button Not Working After Saving Changes

## Problem

After editing an estimate and clicking "Save Changes", clicking the edit button on the same or any other estimate does nothing. The estimate builder doesn't load the selected estimate for editing.

---

## Root Cause

In `MultiTemplateSelector.tsx`, the `handleSaveLineItemChanges` function resets most editing state after a successful save, but it **does NOT reset `editEstimateProcessed`**.

**Current code after save (lines 1179-1184):**
```typescript
// Exit editing mode and hide the estimate builder
setExistingEstimateId(null);
setEditingEstimateNumber(null);
setIsEditingLoadedEstimate(false);  
setSelectedTemplateId(null);
setLineItems([]);
// ❌ MISSING: setEditEstimateProcessed(false);
```

The useEffect that handles the `editEstimate` URL parameter (lines 264-277) has this guard condition:
```typescript
if (editEstimateId && !editEstimateProcessed && !existingEstimateId) {
  setEditEstimateProcessed(true);
  loadEstimateForEditing(editEstimateId);
  // ...
}
```

Since `editEstimateProcessed` stays `true` after the first save, subsequent edit button clicks fail the `!editEstimateProcessed` check and never trigger `loadEstimateForEditing`.

---

## Solution

Add `setEditEstimateProcessed(false)` to the cleanup in `handleSaveLineItemChanges` after a successful save.

### Code Change

**File:** `src/components/estimates/MultiTemplateSelector.tsx`

**Line:** ~1182 (inside `handleSaveLineItemChanges`, after `setIsEditingLoadedEstimate(false)`)

```typescript
// Exit editing mode and hide the estimate builder
setExistingEstimateId(null);
setEditingEstimateNumber(null);
setIsEditingLoadedEstimate(false);
setEditEstimateProcessed(false);  // ← ADD THIS LINE
setSelectedTemplateId(null);
setLineItems([]);
```

---

## Data Flow After Fix

| Step | Before Fix | After Fix |
|------|------------|-----------|
| 1. Click edit on estimate A | `editEstimateProcessed` = true, estimate loads | Same |
| 2. Make changes and save | `editEstimateProcessed` stays true | `editEstimateProcessed` = false |
| 3. Click edit on estimate B | `!editEstimateProcessed` = false → blocked | `!editEstimateProcessed` = true → loads |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/MultiTemplateSelector.tsx` | Add `setEditEstimateProcessed(false)` after save cleanup, around line 1182 |

---

## Expected Result

**Before fix:**
1. Click edit on "Owens Corning - Reroof" → Estimate loads ✓
2. Make changes, click "Save Changes" → Saved ✓
3. Click edit on any estimate → Nothing happens ✗

**After fix:**
1. Click edit on "Owens Corning - Reroof" → Estimate loads ✓
2. Make changes, click "Save Changes" → Saved ✓
3. Click edit on any estimate → Estimate loads ✓

