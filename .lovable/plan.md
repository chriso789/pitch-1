

# Fix: Add Camera Button to Tools Tab

## Problem

The "Add Photo" camera button was placed in the **"Add New" tab**, but users land on the **"Tools" tab** by default. So the camera button is hidden and not immediately accessible.

## Fix

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

- Add a 5th button ("Add Photo" with Camera icon) to the **Tools tab** grid (lines 744-782)
- Change the Tools grid from `grid-cols-4` to `grid-cols-5` to accommodate the new button
- Keep the existing "Add Photo" in the "Add New" tab as well for discoverability

| Change | Detail |
|--------|--------|
| Add Camera button to Tools tab | Insert a Camera/Add Photo button after "Fast Est." in the Tools grid |
| Adjust grid columns | Change `grid-cols-4` to `grid-cols-5` to fit all 5 tool buttons |

