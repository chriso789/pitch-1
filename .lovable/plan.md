

# Fix: Save Estimate Button Greyed Out When Editing

## Problem
The "Save Estimate" button disabled condition on line 2520 requires `selectedTemplateId` to be truthy:
```tsx
disabled={!selectedTemplateId || lineItems.length === 0 || saving || creating || savingLineItems}
```

When editing a loaded estimate (especially one restored via migration with no `template_id`), `selectedTemplateId` is empty, so the button stays disabled. This also blocks estimates created from the Blank Template (which stores `null` as `template_id`).

## Fix

### `src/components/estimates/MultiTemplateSelector.tsx` (line 2520)
Update the disabled condition to allow saving when an existing estimate is loaded:

```tsx
disabled={
  (!selectedTemplateId && !existingEstimateId) || 
  lineItems.length === 0 || 
  saving || creating || savingLineItems
}
```

This means:
- **New estimates**: Still require a template selection before saving
- **Existing estimates being edited**: Only require line items to exist — no template requirement since the estimate already has its data

### One file changed
- `src/components/estimates/MultiTemplateSelector.tsx` -- line 2520 disabled condition

