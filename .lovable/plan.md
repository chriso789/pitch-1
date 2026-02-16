

# Move Camera Button from Map to Property Info Panel

## What Changes

### 1. Remove Camera FAB from Live Map
**File:** `src/pages/storm-canvass/LiveCanvassingPage.tsx`

- Delete the floating Camera FAB button (lines 438-451) that currently sits on the map
- Keep the `CanvassPhotoCapture` component and `showPhotoCapture` state -- they'll now be triggered from the property panel instead

### 2. Wire "Add Photo" Button in Property Info Panel
**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

- The "Add Photo" button already exists (line 791-794) in the "add_new" tab but currently does nothing
- Add local state `showPhotoCapture` to toggle the photo capture dialog
- Import and render `CanvassPhotoCapture` inside the panel, passing the selected property's address and the user's location
- Wire the existing "Add Photo" button's `onClick` to open it

### 3. Pass Photo Capture to Property Panel
**File:** `src/pages/storm-canvass/LiveCanvassingPage.tsx`

- Since `CanvassPhotoCapture` is already rendered in `LiveCanvassingPage`, one approach is to move the dialog rendering into `PropertyInfoPanel` directly so it's self-contained when a pin is selected
- Alternatively, pass `onTakePhoto` callback from `LiveCanvassingPage` to `PropertyInfoPanel` -- but self-contained is cleaner

## Summary

| Change | File | Detail |
|--------|------|--------|
| Remove Camera FAB | `LiveCanvassingPage.tsx` | Delete the floating button (lines 438-451) |
| Add photo capture state + dialog | `PropertyInfoPanel.tsx` | Import `CanvassPhotoCapture`, add state, wire "Add Photo" button |
| Clean up unused state | `LiveCanvassingPage.tsx` | Remove `showPhotoCapture` state if no longer used elsewhere |

