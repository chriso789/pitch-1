
# Fix: Unsaved Changes Guard When Switching Estimates

## Problem

When editing an estimate and making changes, clicking the **Edit** button on a different estimate immediately loads the new estimate without prompting the user to save or discard their changes. This causes data loss.

**Current Behavior:**
1. User edits Estimate A (changes line items, prices, etc.)
2. User clicks "Edit" on Estimate B from the list
3. Estimate B loads immediately — changes to A are **lost**

**Expected Behavior:**
1. User edits Estimate A
2. User clicks "Edit" on Estimate B
3. **Confirmation dialog appears**: "You have unsaved changes. Save or Discard?"
4. User can Save → then switch, or Discard → then switch, or Cancel → stay on A

---

## Solution Overview

1. **Track unsaved changes state** in `MultiTemplateSelector` using existing `is_override` flag
2. **Expose a `beforeEdit` confirmation callback** from `MultiTemplateSelector` to `LeadDetails`
3. **Add confirmation dialog** in `SavedEstimatesList` (or parent) that triggers before navigating

---

## Technical Implementation

### 1. Create Unsaved Changes Context/Hook in MultiTemplateSelector

Add state tracking and expose a method for parent components to check for unsaved changes:

```typescript
// In MultiTemplateSelector.tsx

// Expose hasUnsavedChanges check - considering line item modifications
const hasUnsavedChanges = useMemo(() => {
  return existingEstimateId && lineItems.some(item => item.is_override);
}, [existingEstimateId, lineItems]);
```

### 2. Add Confirmation Dialog Component

Create a reusable dialog for unsaved changes prompts:

```typescript
// New component or inline in SavedEstimatesList
<AlertDialog open={showUnsavedWarning}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
      <AlertDialogDescription>
        You have unsaved changes to "{currentEditingEstimate}". 
        What would you like to do?
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={handleCancelSwitch}>
        Cancel
      </AlertDialogCancel>
      <Button variant="outline" onClick={handleDiscardAndSwitch}>
        Discard Changes
      </Button>
      <Button onClick={handleSaveAndSwitch}>
        Save Changes
      </Button>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### 3. Update SavedEstimatesList with Guarded Edit

Modify the Edit button click handler to check for unsaved changes:

```typescript
// In SavedEstimatesList.tsx
interface SavedEstimatesListProps {
  // ... existing props
  onEditEstimate?: (estimateId: string) => void;
  currentEditingId?: string | null;  // NEW - which estimate is currently open
  hasUnsavedChanges?: boolean;       // NEW - are there unsaved changes
  onSaveAndSwitch?: () => Promise<void>;  // NEW - save then switch callback
}

// In the Edit button handler:
onClick={(e) => {
  e.stopPropagation();
  
  // If there's an active estimate being edited with changes, show confirmation
  if (currentEditingId && currentEditingId !== estimate.id && hasUnsavedChanges) {
    setPendingEditId(estimate.id);
    setShowUnsavedWarning(true);
    return;
  }
  
  // Otherwise proceed directly
  onEditEstimate?.(estimate.id);
}}
```

### 4. Update LeadDetails.tsx Integration

Pass the required props through to `SavedEstimatesList`:

```typescript
// In LeadDetails.tsx - estimate tab render
<SavedEstimatesList 
  pipelineEntryId={id!} 
  currentEditingId={/* from URL param or state */}
  hasUnsavedChanges={/* passed up from MultiTemplateSelector */}
  onEditEstimate={(estimateId) => {
    navigate(`/lead/${id}?tab=estimate&editEstimate=${estimateId}`);
  }}
  onSaveAndSwitch={async () => {
    // Trigger save in MultiTemplateSelector then switch
  }}
/>
```

### 5. Option B: Self-Contained in SavedEstimatesList (Simpler)

Alternatively, have `SavedEstimatesList` read the URL param directly to determine if editing is active:

```typescript
// In SavedEstimatesList
const [searchParams] = useSearchParams();
const currentEditingId = searchParams.get('editEstimate');

// Then in edit handler:
if (currentEditingId && currentEditingId !== estimate.id) {
  // Show warning - even if we don't know if there are changes,
  // ask for confirmation when switching between estimates
  const confirmed = window.confirm(
    'You are currently editing another estimate. Switch anyway?'
  );
  if (!confirmed) return;
}
onEditEstimate?.(estimate.id);
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/SavedEstimatesList.tsx` | Add unsaved changes confirmation dialog, track pending edit state |
| `src/pages/LeadDetails.tsx` | Pass `hasUnsavedChanges` and `onSaveAndSwitch` props to `SavedEstimatesList` |
| `src/components/estimates/MultiTemplateSelector.tsx` | Expose `hasUnsavedChanges` computed value via callback or ref |

---

## User Flow After Implementation

```text
User editing Estimate A with changes
       │
       ▼
User clicks "Edit" on Estimate B
       │
       ▼
Dialog: "You have unsaved changes to Estimate A"
       │
   ┌───┴───┬───────────┐
   │       │           │
[Cancel] [Discard]  [Save]
   │       │           │
   ▼       ▼           ▼
Stay on A  Load B    Save A → Load B
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No estimate currently being edited | Proceed directly to edit |
| Editing but no changes made | Proceed directly (no `is_override` items) |
| Clicking Edit on same estimate | Do nothing / show toast |
| User clicks Cancel in dialog | Stay on current estimate |
| Save fails | Show error, stay on current estimate |

---

## Result After Implementation

1. User edits estimate and makes changes
2. User clicks Edit on different estimate
3. **Confirmation dialog appears with 3 options**:
   - **Cancel**: Stay on current estimate
   - **Discard Changes**: Load new estimate, lose changes
   - **Save Changes**: Save current, then load new estimate
4. No more accidental data loss when switching between estimates
