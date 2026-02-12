

## Fix: Contacts Board Left-Scroll Issue

### Problem

The kanban board scrolls right to show later columns but won't scroll back left to reveal the "New / Unassigned" column. This happens because:
1. The columns have no fixed `min-width`, so the browser collapses or shifts them
2. The scroll container (`overflow-x-auto` div) may initialize with a non-zero scroll position
3. The `CardContent` wrapper adds padding that can interfere with the scroll boundary

### Changes

**File: `src/features/contacts/components/ContactKanbanBoard.tsx`**

- Add a fixed `min-w-[250px]` to each column wrapper so columns don't collapse and the scroll container properly accounts for all columns
- Wrap the scrollable area in a container that ensures it starts scrolled to the left (scroll position 0)

**File: `src/features/contacts/components/ContactKanbanColumn.tsx`**

- Add `min-w-[250px] w-[250px] flex-shrink-0` to the column root div so every column has a consistent fixed width and won't be collapsed by the flex container

### Result

All columns will have a consistent width, the scroll container will properly allow scrolling in both directions, and the "New / Unassigned" column will always be visible at the left edge when the board loads.
