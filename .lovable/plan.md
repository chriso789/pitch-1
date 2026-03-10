

# Fix Status Dropdown & Add "Completed Project" Status

## Issues

1. **Double-click on status dropdown**: The `SelectTrigger` on the ContactProfile page uses `h-7` (28px) which is too small and causes click-target issues with Radix Select. Fix: increase height to `h-8`, add `cursor-pointer`, and ensure no parent click handlers are intercepting the first click.

2. **New "Completed / Past Customer" status**: Add a new default contact status (e.g. **"Past Customer"** or **"Completed"**) that:
   - Shows on the Kanban board and canvass map with a distinct color (e.g. gold/green checkmark)
   - Gets auto-applied when a pipeline entry reaches "Completed" stage
   - Signals to reps in the canvass app: "This homeowner already did business with us"

## Changes

### 1. Fix double-click — `src/pages/ContactProfile.tsx`
- Change `SelectTrigger` from `h-7` to `h-8` with explicit `cursor-pointer`
- Wrap the Select in a `div` with `onClick={e => e.stopPropagation()}` to prevent the parent flex container from swallowing the first click

### 2. Add "Past Customer" status — `src/hooks/useContactStatuses.ts`
- Add a new default status entry:
  ```
  { name: 'Past Customer', key: 'past_customer', color: '#10b981', status_order: 7 }
  ```
- This makes it immediately available in all dropdowns, Kanban columns, and canvass map markers

### 3. Add to ContactForm dropdown — `src/features/contacts/components/ContactForm.tsx`
- Add `<SelectItem value="past_customer">Past Customer</SelectItem>` to the qualification status options

### 4. Add to bulk import normalizer — `src/features/contacts/components/ContactBulkImport.tsx`
- Map common CSV values like "completed", "past customer", "finished" to the `past_customer` key

### 5. Auto-set on project completion — `src/pages/LeadDetails.tsx`
- When a pipeline entry status changes to "completed", also update the associated contact's `qualification_status` to `past_customer`

### 6. Canvass map marker color — `src/pages/storm-canvass/LiveCanvassingPage.tsx` & `TerritoryMapPage.tsx`
- Add `past_customer` to the marker color mapping with a distinct green/gold so reps can see "already a customer" homes on the map

