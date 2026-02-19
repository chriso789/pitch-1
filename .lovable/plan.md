

# Fix: "X" Button Not Closing Preview Estimate Dialog

## Root Cause

Two issues prevent the close button from working:

1. **Pointer events blocked**: The Radix auto-generated close button (absolute positioned at top-right) is being covered by the `DialogHeader` which has `relative z-10` and the full-height content `div` below it. The CSS hack `[&>button:last-child]:z-[60]` is unreliable because `overflow-hidden` on the DialogContent clips interactive areas, and sibling stacking contexts interfere.

2. **Nested Dialog conflict**: The `ShareEstimateDialog` component is rendered *inside* the outer `<Dialog>` root (between `</DialogContent>` and `</Dialog>`). This places it within the same Radix Dialog context, which can cause the parent dialog's `onOpenChange` to fire unexpectedly when the nested dialog unmounts or state changes.

## Fix (2 files)

### File 1: `src/components/estimates/EstimatePreviewPanel.tsx`

- **Hide the Radix auto-generated close button** entirely using `[&>button:last-child]:hidden`
- **Add an explicit close button** inside the `DialogHeader` with a direct `onClick={() => onOpenChange(false)}` call -- this avoids all z-index and pointer-event issues
- **Move `ShareEstimateDialog` outside the `<Dialog>` root** so it renders as a sibling, not a nested child, eliminating Radix context conflicts

```text
Before:
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="... [&>button:last-child]:z-[60] ...">
      <DialogHeader>
        <DialogTitle>Preview Estimate</DialogTitle>
      </DialogHeader>
      ...content...
    </DialogContent>
    <ShareEstimateDialog ... />   <-- INSIDE Dialog root (bad)
  </Dialog>

After:
  <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="... [&>button:last-child]:hidden">
        <DialogHeader>
          <DialogTitle>Preview Estimate</DialogTitle>
          <button onClick={() => onOpenChange(false)}>X</button>  <-- explicit
        </DialogHeader>
        ...content...
      </DialogContent>
    </Dialog>
    <ShareEstimateDialog ... />   <-- OUTSIDE Dialog root (correct)
  </>
```

### File 2: No other files need changes

The `MultiTemplateSelector.tsx` passes `onOpenChange={setShowPreviewPanel}` which is correct. The `showPreview` URL parameter useEffect only fires when the URL actually contains `showPreview=true`, which is not the case during normal close operations.

## What This Fixes

- Clicking the X button will reliably close the dialog and it will stay closed
- No more pointer-event blocking from overlapping elements
- No more Radix Dialog context conflicts from nested dialogs
- Share functionality continues to work (just rendered outside the Dialog tree)

