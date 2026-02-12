

## Fix Contacts Kanban Board Scrolling (Both Directions)

### Problem

The kanban board container at line 180 of `ContactKanbanBoard.tsx` has `overflow-x-auto`, but:
1. The parent `CardContent` constrains the board width, preventing horizontal scroll from activating properly
2. Columns have no max-height or vertical overflow -- they just grow infinitely tall, making the whole page stretch instead of scrolling within the column

### Changes

**File: `src/features/contacts/components/ContactKanbanBoard.tsx`**

- Replace the board wrapper `div` (line 180) with a dedicated scroll container that has:
  - `overflow-x-auto` for horizontal scrolling
  - `overscroll-behavior-x: contain` to prevent browser back/forward gestures
  - A calculated max-height (`max-h-[calc(100vh-280px)]`) so the board fits the viewport

**File: `src/features/contacts/components/ContactKanbanColumn.tsx`**

- Add vertical scrolling to the drop zone area:
  - Set `max-h-[calc(100vh-340px)]` and `overflow-y-auto` on the drop zone div (line 58)
  - This keeps columns scrollable independently within the viewport

**File: `src/features/contacts/components/EnhancedClientList.tsx`**

- On the wrapping `CardContent` (line 1332), add `overflow-hidden` to prevent it from clipping the inner scroll container, and remove any padding that fights the board's own spacing

### Summary

| File | Change |
|------|--------|
| `ContactKanbanBoard.tsx` | Add `overscroll-behavior-x: contain` and viewport-aware max-height to the flex container |
| `ContactKanbanColumn.tsx` | Add `max-h` + `overflow-y-auto` to column drop zones for vertical scroll |
| `EnhancedClientList.tsx` | Ensure `CardContent` doesn't block overflow |

