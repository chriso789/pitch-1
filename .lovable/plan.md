

# Fix: Make "Edit Lead Details" More Visible

## Problem

The edit button for lead details (Priority, Roof Type, Roof Age, Est. Value) is a tiny 3px pencil icon at the end of the stats bar — nearly invisible. When most fields are empty, users can't find where to edit them.

## Changes

### `src/pages/LeadDetails.tsx`

**Replace the tiny pencil button with a labeled "Edit Details" button** in the stats bar, and always show placeholder text for empty fields so users know what can be edited:

- Show "Priority: Medium" (or "Not set" if empty) — always visible
- Show "Roof Type: Not set" when empty — always visible  
- Show "Roof Age: Not set" when empty — always visible
- Show "Est. Value: Not set" when empty — always visible
- Replace the 3px ghost pencil with a visible `<Button variant="outline" size="sm">` labeled with a pencil icon + "Edit" text

This ensures all four editable fields are always visible (with "Not set" placeholders) and the edit button is prominent and labeled.

