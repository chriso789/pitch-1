
# Fix: Deleted Estimate Still Showing in Edit Mode

## Problem
When you delete an estimate from the "Saved Estimates" list, the estimate builder below still shows "Viewing saved estimate" with the deleted estimate's line items loaded. This happens because `SavedEstimatesList` and `MultiTemplateSelector` are sibling components -- deleting in one does not notify the other to clear its internal state.

## Changes

### 1. `src/components/estimates/SavedEstimatesList.tsx`
Add a new optional prop `onEstimateDeleted` to the component interface. Call it after a successful delete, passing the deleted estimate ID:

```typescript
// Add to props interface
onEstimateDeleted?: (estimateId: string) => void;

// Call at end of handleDeleteEstimate (after cache invalidation, before toast)
onEstimateDeleted?.(estimateToRemove.id);
```

### 2. `src/components/estimates/MultiTemplateSelector.tsx`
Add a new optional prop `clearEditingEstimateId` that, when set, causes the component to clear its editing state if it matches the currently loaded estimate:

```typescript
// Add to props interface
clearEditingEstimateId?: string | null;

// Add useEffect to react when it changes
useEffect(() => {
  if (clearEditingEstimateId && clearEditingEstimateId === existingEstimateId) {
    setExistingEstimateId(null);
    setEditingEstimateNumber(null);
    setIsEditingLoadedEstimate(false);
    setEstimateDisplayName('');
    setLineItems([]);
    resetToOriginal();
  }
}, [clearEditingEstimateId]);
```

### 3. `src/pages/LeadDetails.tsx`
Wire the two together with a state variable:

```typescript
const [deletedEstimateId, setDeletedEstimateId] = useState<string | null>(null);

// On SavedEstimatesList:
<SavedEstimatesList
  ...
  onEstimateDeleted={(id) => setDeletedEstimateId(id)}
/>

// On MultiTemplateSelector:
<MultiTemplateSelector
  ...
  clearEditingEstimateId={deletedEstimateId}
/>
```

## Result
When you delete an estimate from the saved list, the estimate builder immediately clears its editing state and returns to the blank/template-selection view.
