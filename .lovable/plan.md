

# Fix Pipeline Board Horizontal Scroll

## Problem
The pipeline Kanban board uses Radix `ScrollArea` for horizontal scrolling (line 246-278 in `KanbanPipeline.tsx`). Radix ScrollArea is known to have issues with bidirectional horizontal scrolling — it can lock out leftward scrolling, especially when combined with `DndContext` pointer/touch event interception.

## Solution
Replace `ScrollArea` + `ScrollBar` with a native `div` using `overflow-x: auto` and `-webkit-overflow-scrolling: touch`. This is simpler, more reliable, and works properly with drag-and-drop.

### File: `src/features/pipeline/components/KanbanPipeline.tsx`

**Lines 246-278** — Replace:
```tsx
<ScrollArea className="w-full">
  <div className="flex gap-2 min-h-[600px] pb-4" style={{ minWidth: `${stages.length * 60}px` }}>
    ...
  </div>
  <ScrollBar orientation="horizontal" />
</ScrollArea>
```

With:
```tsx
<div className="w-full overflow-x-auto pb-4" style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}>
  <div className="flex gap-2 min-h-[600px]" style={{ minWidth: `${stages.length * 60}px` }}>
    ...
  </div>
</div>
```

Also remove the unused `ScrollArea`/`ScrollBar` import on line 4.

