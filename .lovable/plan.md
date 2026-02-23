

# Blank Template + Trade Filtering + Inspection Button Visibility

## 3 Issues to Fix

### Issue 1: No "Blank Template" Option
Users need a way to build a custom estimate from scratch without pre-populated line items. Currently, every template loads line items from `estimate_calc_template_items`. A "Blank Template" would start with zero line items, letting the user add their own via the existing "Add Item" functionality, while still running full overhead/commission/tax calculations.

### Issue 2: Template Dropdowns Show All Templates Regardless of Trade
The `TemplateCombobox` currently groups by `roof_type` (shingle, metal, etc.) which is roofing-specific. When a non-roofing trade (Gutters, Siding, etc.) is selected, `matchesTradeCategory` correctly filters templates, but if no matching templates exist it falls back to showing ALL templates (`filteredTemplates.length > 0 ? filteredTemplates : templates`). This means a Gutters trade shows roofing templates. Each trade's dropdown should only show its own templates plus a "Blank Template" option.

### Issue 3: Inspection Walkthrough Button Not Visible
The "Start Inspection" button exists in the code (line 1162 of LeadDetails.tsx) but it's inside the "Photos" tab. The user needs to click the "Photos" tab first. The button is there and working -- it's just hidden behind the tab that defaults to "Comms".

## Changes

### 1. Add Virtual "Blank Template" to Every Trade Dropdown

**File: `src/components/estimates/MultiTemplateSelector.tsx`**

- Define a constant `BLANK_TEMPLATE` with a special ID (e.g., `'__blank__'`)
- In `handleTemplateSelect`, detect the blank template ID and set empty line items instead of fetching from `estimate_calc_template_items`
- When blank template is selected, enable "creating new estimate" mode with zero line items -- the user adds items via the existing "Add Item" button
- All financial calculations (overhead, commission, tax, profit margin) still run through `useEstimatePricing` as items get added

**File: `src/components/estimates/TemplateCombobox.tsx`**

- Accept a new optional `showBlankOption` prop (default `true`)
- Render a "Blank Template" item at the top of the list, before any grouped templates, with a distinct visual (e.g., Plus icon instead of checkmark prefix, muted description "Start from scratch")
- This appears in every trade's dropdown

### 2. Stop Fallback to All Templates for Non-Roofing Trades

**File: `src/components/estimates/MultiTemplateSelector.tsx` (line 2060)**

Current code:
```
templates={filteredTemplates.length > 0 ? filteredTemplates : templates}
```

Change to always pass `filteredTemplates` (no fallback). Combined with the blank template being injected, every trade will always have at least the blank option even if no real templates exist for that trade.

### 3. Make Inspection Button More Discoverable

**File: `src/pages/LeadDetails.tsx`**

Move the "Start Inspection" button out of the Photos tab content and into a more prominent position -- add it as a tool/action alongside the existing toolbar area (near the Approval Requirements section or as an additional tab trigger). Alternatively, add an "Inspection" tab to the tabs list so it's visible at the same level as Comms/Photos/Activity.

**Recommended approach:** Add a dedicated "Inspection" tab trigger in the TabsList (line 1088-1110) that, when clicked, shows the inspection button and any past inspection summaries. This makes it immediately visible without requiring the user to navigate to Photos first.

## Technical Details

### Blank Template Constant
```typescript
const BLANK_TEMPLATE = {
  id: '__blank__',
  name: 'Blank Template',
  roof_type: 'other',
  template_category: 'universal', // matches all trades
};
```

### Template Selection Handler Update
When `templateId === '__blank__'`:
- Set `selectedTemplateId` to `'__blank__'`
- Call `setLineItems([])` (empty array)
- Set `setIsCreatingNewEstimate(true)`
- Skip `fetchLineItems` call
- The "Add Item" UI is already available for the user to manually build line items

### TemplateCombobox Changes
- Add `showBlankOption?: boolean` prop
- Prepend blank template option before grouped templates
- Blank template renders in its own group header ("CUSTOM") or ungrouped at the top

### Trade Filtering Fix
- Remove the fallback `filteredTemplates.length > 0 ? filteredTemplates : templates`
- Always pass `filteredTemplates` to `TemplateCombobox`
- The blank template is injected into every trade's filtered list

### Inspection Tab Addition
- Add `TabsTrigger value="inspection"` with ClipboardCheck icon
- Add `TabsContent value="inspection"` with the Start Inspection button and inspection history query
- Remove the button from inside the Photos tab

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/MultiTemplateSelector.tsx` | Add blank template constant, handle blank selection, remove all-templates fallback |
| `src/components/estimates/TemplateCombobox.tsx` | Add blank template option at top of dropdown |
| `src/pages/LeadDetails.tsx` | Add Inspection tab to make the button discoverable |
| `src/lib/trades.ts` | Add `'universal'` match to `matchesTradeCategory` so blank template appears in all trades |
