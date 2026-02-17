

# Fix: Storm Reports List Not Scrollable

## Problem
The storm reports dialog shows 61 events but users cannot scroll through them. The `ScrollArea` component uses `max-h-[60vh]` but Radix ScrollArea requires a fixed/constrained height on the viewport to enable scrolling. The outer container has `overflow-hidden` which clips the content but the inner ScrollArea never activates its scrollbar.

## Fix

### File: `src/components/storm-canvass/PropertyInfoPanel.tsx`

Change the ScrollArea from using `max-h` (which doesn't constrain Radix's internal viewport) to using `flex-1 overflow-hidden` within a flex column layout:

1. Make the storm dialog inner container a flex column: add `flex flex-col` to the `max-h-[70vh]` div
2. Change `ScrollArea className="max-h-[60vh] p-4"` to `ScrollArea className="flex-1 overflow-hidden"` and wrap the content inside with padding
3. This lets the ScrollArea fill remaining space after the header and filter tabs, and properly constrains its height so the Radix scroll viewport activates

The result: the header and filter tabs stay fixed at the top, and the report list scrolls within the remaining space.

