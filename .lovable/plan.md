

# Fix: Preview Estimate Dialog Keeps Re-Opening After Clicking X

## Root Cause Found

The `showPreview` URL parameter is being cleared using `window.history.replaceState()`, but the component reads URL params via React Router's `useSearchParams()`. React Router is **completely unaware** of `replaceState` changes, so it still sees `showPreview=true` in the URL.

Here is what happens step by step:

1. URL contains `showPreview=true`
2. useEffect sees it, opens the preview dialog, and calls `replaceState` to "clear" it
3. User clicks the X button, setting `showPreviewPanel` to `false`
4. Since `showPreviewPanel` is a dependency of that useEffect, the effect re-runs
5. React Router's `searchParams` still returns `showPreview=true` (replaceState didn't update it)
6. The effect sees `showPreview=true` and `!showPreviewPanel`, so it re-opens the dialog
7. This creates an infinite loop where the dialog can never stay closed

## The Fix

**File: `src/components/estimates/MultiTemplateSelector.tsx`**

Two changes:

1. Use React Router's `setSearchParams` instead of `window.history.replaceState` so the URL param is properly cleared in React Router's state
2. Remove `showPreviewPanel` from the useEffect dependency array so closing the dialog doesn't re-trigger the effect

```tsx
// Before (broken):
const [searchParams] = useSearchParams();
// ...
useEffect(() => {
  const showPreview = searchParams.get('showPreview');
  if (showPreview === 'true' && existingEstimateId && !showPreviewPanel) {
    setShowPreviewPanel(true);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('showPreview');
    const newUrl = `${window.location.pathname}?${newParams.toString()}`;
    window.history.replaceState({}, '', newUrl);  // React Router doesn't see this!
  }
}, [searchParams, existingEstimateId, showPreviewPanel]); // showPreviewPanel triggers re-run

// After (fixed):
const [searchParams, setSearchParams] = useSearchParams();
// ...
useEffect(() => {
  const showPreview = searchParams.get('showPreview');
  if (showPreview === 'true' && existingEstimateId) {
    setShowPreviewPanel(true);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('showPreview');
      return next;
    }, { replace: true });
  }
}, [searchParams, existingEstimateId, setSearchParams]);
```

No other files need changes. The X button itself is working correctly -- the problem is entirely in this useEffect loop.

