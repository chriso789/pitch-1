
# Fix: Unsaved Changes Guard When Switching Estimates

## Status: ✅ IMPLEMENTED

## Problem

When editing an estimate and making changes, clicking the **Edit** button on a different estimate immediately loads the new estimate without prompting the user to save or discard their changes. This causes data loss.

## Solution Implemented

1. **Track unsaved changes state** in `MultiTemplateSelector` using `is_override` flag on line items
2. **Expose state via callback** - `onUnsavedChangesChange` prop notifies parent
3. **Expose save via ref** - `saveChangesRef` allows parent to trigger save
4. **Confirmation dialog** in `SavedEstimatesList` with 3 options

---

## Files Modified

| File | Changes |
|------|---------|
| `src/components/estimates/SavedEstimatesList.tsx` | Added unsaved changes confirmation dialog with Cancel/Discard/Save options |
| `src/pages/LeadDetails.tsx` | Added state tracking and wired up callbacks between components |
| `src/components/estimates/MultiTemplateSelector.tsx` | Added `hasUnsavedChanges` computed value, `onUnsavedChangesChange` callback, and `saveChangesRef` for external save triggering |

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

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| No estimate currently being edited | Proceed directly to edit |
| Editing but no changes made | Proceed directly (no `is_override` items) |
| Clicking Edit on same estimate | Do nothing |
| User clicks Cancel in dialog | Stay on current estimate |
| Save fails | Show error toast, stay on current estimate |
