

## Fix: Always-Visible Arrow Button on Pipeline Cards (Mobile Priority)

### Problem

The "View Details" arrow button on pipeline Kanban cards is inconsistently visible, especially on mobile. From the screenshot, only the first card ("Ken Contact") shows the arrow while the others ("Test Contact", "Fred Lester") do not. The current styling uses `opacity-100 md:opacity-0 md:group-hover:opacity-100` which should work on mobile, but the small size and absolute positioning at `bottom-0 left-0` makes it easy to miss or overlap with other elements.

### Solution

Make the arrow button always visible on all screen sizes, increase its touch target, and give it a subtle background so it stands out clearly.

### Changes

**File: `src/features/pipeline/components/KanbanCard.tsx`** -- line 512-521

Update the arrow button styling:
- Remove `md:opacity-0 md:group-hover:opacity-100` so it is always visible on all devices
- Keep the large `h-8 w-8` mobile touch target
- Add a subtle background tint so the arrow is clearly tappable
- Increase icon contrast

Current (line 515):
```
className="absolute bottom-0 left-0 h-8 w-8 md:h-5 md:w-5 p-0 text-primary/70 hover:text-primary hover:bg-primary/10 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center"
```

Updated:
```
className="absolute bottom-0 left-0 h-8 w-8 p-0 text-primary hover:text-primary hover:bg-primary/10 bg-primary/5 rounded-tr-md opacity-100 transition-opacity flex items-center justify-center z-10"
```

Key changes:
- Removed `md:h-5 md:w-5` -- keeps `h-8 w-8` on all sizes for easy tapping
- Removed `md:opacity-0 md:group-hover:opacity-100` -- always visible now
- Changed `text-primary/70` to `text-primary` -- stronger color
- Added `bg-primary/5` -- subtle background tint so it reads as a button
- Added `rounded-tr-md` -- rounds the inner corner for polish
- Added `z-10` -- ensures it layers above card content

### Files Modified

| File | Action |
|------|--------|
| `src/features/pipeline/components/KanbanCard.tsx` | UPDATE -- make arrow always visible with larger touch target |

