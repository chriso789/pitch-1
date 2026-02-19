

# Fix: Make the "X" Close Button Visible on Preview Estimate Dialog

## Problem

The close button exists and works, but it's invisible because it uses the default foreground color at 70% opacity against a matching background. The small `h-4 w-4` icon blends completely into the header.

## Fix

**File: `src/components/estimates/EstimatePreviewPanel.tsx`** (line 501-508)

Make the X button clearly visible by:
- Adding a background, border, and shadow so it stands out
- Increasing icon size from `h-4 w-4` to `h-5 w-5`
- Setting full opacity instead of `opacity-70`

```tsx
<button
  type="button"
  className="absolute right-4 top-4 z-[70] rounded-md border bg-background p-1.5 shadow-sm transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
  onClick={() => onOpenChange(false)}
>
  <X className="h-5 w-5" />
  <span className="sr-only">Close</span>
</button>
```

This gives the button a visible card-like appearance (border + background + shadow) so it's always clearly visible in the top-right corner regardless of the header background.

