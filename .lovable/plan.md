
# Plan: Fix Pipeline Stage List Not Showing All Stages

## Problem Identified

**Good news:** Your "Working" stage **was saved successfully!** ✓

The database confirms all 11 stages exist:
1. Leads
2. Contingency Signed
3. Legal Review
4. Ready for Approval
5. Project
6. Completed
7. Closed
8. Lost
9. Canceled
10. Duplicate
11. **Working** (your new stage at order 11)

**The Problem:** The Settings UI's scroll container (`max-h-[500px]`) is not tall enough to show all stages, and the scrollbar may not be visible or the component may be clipping content.

## Solution

Fix the ScrollArea container to properly display all stages and ensure scrolling works correctly.

## Implementation

### Part 1: Increase ScrollArea Height and Fix Overflow

Update `PipelineStageManager.tsx` to:
1. Increase `max-h-[500px]` to `max-h-[600px]` or use viewport-relative sizing
2. Add proper padding at the bottom so the last items aren't cut off
3. Ensure the ScrollArea properly handles the full content

### Part 2: Add Stage Count Display

Show a count of total stages so users know if there are more stages below the visible area.

## File Changes

| File | Change |
|------|--------|
| `src/components/settings/PipelineStageManager.tsx` | Fix ScrollArea height, add bottom padding, show stage count |

## Technical Details

```tsx
// Before
<ScrollArea className="max-h-[500px]">
  <div className="space-y-2">
    {stages.map(...)}
  </div>
</ScrollArea>

// After
<ScrollArea className="max-h-[calc(100vh-400px)] min-h-[300px]">
  <div className="space-y-2 pb-4">
    {stages.map(...)}
  </div>
</ScrollArea>
```

Also add a stage count indicator in the header:

```tsx
<CardTitle>Stage Order</CardTitle>
<CardDescription>
  Drag or use arrows to reorder. Stages appear left-to-right in the Kanban view.
  <span className="block mt-1 font-medium">{stages.length} stages configured</span>
</CardDescription>
```

## Verification

After implementation, you should:
1. See all 11 stages including "Working", "Lost", "Canceled", and "Duplicate"
2. Be able to scroll through the full list
3. See the stage count in the header

## Summary

Your data is safe - the stage saved correctly. This is purely a UI display fix to show the full list of pipeline stages.
