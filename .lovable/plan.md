## Problem

In `src/components/estimates/MultiTemplateSelector.tsx` (line 2744), the **Save Estimate** button is disabled by:

```ts
(!selectedTemplateId && !existingEstimateId && !tradeSections.some(t => !!t.templateId))
  || saving || creating || savingLineItems
```

When the user is editing a loaded estimate (line items present, $34,590.40 selling price visible), the button still appears greyed because `existingEstimateId` may not yet be hydrated, and `isEditingLoadedEstimate` is not part of the gate. The current tri-state logic only treats `existingEstimateId !== null` as "saveable", missing the "loaded estimate" and "has line items" paths.

## Fix

Update the disabled condition to also treat the estimate as saveable when:
- `isEditingLoadedEstimate` is true, OR
- `lineItems.length > 0` (the user has real items to persist)

New condition:

```ts
disabled={
  (
    !selectedTemplateId &&
    !existingEstimateId &&
    !isEditingLoadedEstimate &&
    lineItems.length === 0 &&
    !tradeSections.some(t => !!t.templateId)
  ) || saving || creating || savingLineItems
}
```

Update the `title` tooltip to match (only show "Select a template…" when truly empty).

## Files

- `src/components/estimates/MultiTemplateSelector.tsx` — adjust `disabled` + `title` on the Save Estimate button (~lines 2742–2754).

## Verification

- Load an existing estimate with line items → Save Estimate is active.
- Start a fresh estimate with no template and no items → Save Estimate remains disabled with the existing tooltip.
- Click Save while saving → button shows spinner and stays disabled.
