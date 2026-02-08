
# Plan: Fix Material Autocomplete for Labor + Add Note Button for Line Items

## Problems Identified

### 1. Labor Items Don't Show Catalog Autocomplete
When clicking "Add Labor Item", the form uses a plain text input instead of the `MaterialAutocomplete` component. This means users can't search and select from cataloged items when adding labor.

**Current code (line 384-389):**
```tsx
<Input
  value={newItem.item_name}
  onChange={(e) => onNewItemChange({ ...newItem, item_name: e.target.value })}
  placeholder="Item name"
  autoFocus
/>
```

**Should be:**
```tsx
<MaterialAutocomplete
  value={newItem.item_name}
  onChange={(value) => onNewItemChange({ ...newItem, item_name: value })}
  onSelectMaterial={(material) => {
    onNewItemChange({
      ...newItem,
      item_name: material.name,
      unit: material.uom,
      unit_cost: material.base_cost,
      material_id: material.id,
    });
  }}
  placeholder="Search items..."
  autoFocus
/>
```

### 2. No Way to Add Notes to Existing Line Items
Currently, notes can only be added when creating a new item. Once an item is on the estimate, there's no way to add or edit notes/color specifications.

---

## Solution

### Part 1: Use MaterialAutocomplete for Labor Items
Replace the plain `<Input>` in the labor section with `MaterialAutocomplete` so users can search catalog items for both materials and labor.

### Part 2: Add Note Button to Each Line Item Row
Add a "note" icon button next to each item name that:
- Shows a small popover or inline edit field
- Allows adding/editing notes (color, specs, etc.)
- Displays a visual indicator when notes exist

---

## Implementation Details

### File: `src/components/estimates/SectionedLineItemsTable.tsx`

**Change 1: Import additional components**
- Add `Popover`, `PopoverTrigger`, `PopoverContent` from Radix
- Add `StickyNote` or `MessageSquare` icon from Lucide

**Change 2: Replace Labor Input with MaterialAutocomplete**
- Lines 383-390: Change from `<Input>` to `<MaterialAutocomplete>`

**Change 3: Add Note Button to Item Row**
- Add a note icon button in the item name cell
- Icon shows as filled/highlighted if notes exist
- Clicking opens a popover with a text input
- Changes save via `onUpdateItem(id, { notes: newValue })`

---

## Visual Preview

**Before (item row):**
```
| Polyglass MTS [Modified]          | 28 | $125.00 | $3,500.00 | [Delete] |
```

**After (item row):**
```
| Polyglass MTS [Modified] [Note📝] | 28 | $125.00 | $3,500.00 | [Delete] |
  Color/Specs: Charcoal
```

The note icon will:
- Be visible on hover (or always visible if notes exist)
- Be tinted amber/yellow when notes are present
- Open a popover for editing

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/SectionedLineItemsTable.tsx` | 1. Replace labor `<Input>` with `<MaterialAutocomplete>` 2. Add note button/popover to item rows |

---

## Technical Details

### Note Button Component (inline in file)

```tsx
// Inside renderItemRow function, in the item name cell
<div className="flex items-center gap-1">
  <span>{item.item_name}</span>
  {editable && (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-5 w-5 ${item.notes ? 'text-amber-500' : 'opacity-0 group-hover:opacity-50'}`}
          title="Add note"
        >
          <StickyNote className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <Label>Color / Notes</Label>
        <Textarea
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          placeholder="e.g. Charcoal, 26 gauge"
        />
        <Button size="sm" onClick={() => onUpdateItem(item.id, { notes: noteValue })}>
          Save
        </Button>
      </PopoverContent>
    </Popover>
  )}
</div>
```

### State Management
A local state for the editing note will be managed within a sub-component or using a controlled popover pattern to track which item's note is being edited.

---

## Expected Result

After implementation:
1. Clicking "Add Labor Item" shows the same autocomplete dropdown as materials
2. Each line item has a small note icon next to the name
3. Clicking the icon opens a popover to add/edit notes
4. Notes are saved immediately and display below the item name
5. Items with notes show a visible amber note icon
