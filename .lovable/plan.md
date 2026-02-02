
# Fix Back Button Not Working on Lead Details Page

## Problem

The "Back" button on the Lead Details page (`/lead/:id`) does not navigate anywhere when clicked. The user remains on the same page.

**Root Cause:** The `useBrowserBackButton` hook relies on `document.referrer` to check if the user came from within the app. However, `document.referrer` is NOT updated during client-side SPA navigation - it only reflects the original referrer when the browser tab was opened. This means:

- When user clicks a lead from Pipeline → `document.referrer` is NOT updated
- The check `document.referrer.includes(window.location.host)` returns `false`
- The hook falls back to `navigate(fallbackPath)` but that also seems to fail silently

---

## Solution

Simplify the `goBack` logic to use a more reliable approach:

| Priority | Check | Action |
|----------|-------|--------|
| 1 | `location.state?.from` exists | Navigate to that path |
| 2 | Has browser history (`history.length > 1`) | Use `navigate(-1)` |
| 3 | Fallback | Navigate to `fallbackPath` |

The key change: **Trust the browser's history stack** instead of checking `document.referrer`. If `window.history.length > 1`, we know there's a history entry to go back to.

---

## File to Modify

**`src/hooks/useBrowserBackButton.tsx`**

---

## Code Changes

### Before (Broken Logic)
```typescript
const goBack = useCallback(() => {
  if (location.state?.from) {
    navigate(location.state.from);
    return;
  }
  
  // ❌ This check is unreliable in SPAs
  const isInternalReferrer = document.referrer && 
    document.referrer.includes(window.location.host);
  
  if (isInternalReferrer) {
    navigate(-1);
  } else {
    navigate(fallbackPath);
  }
}, [navigate, fallbackPath, location.state]);
```

### After (Fixed Logic)
```typescript
const goBack = useCallback(() => {
  // Priority 1: Use explicit navigation state if provided
  if (location.state?.from) {
    navigate(location.state.from);
    return;
  }
  
  // Priority 2: Use browser history if available
  // history.length > 2 accounts for the initial page + at least one navigation
  // (browsers often start with length 1 or 2 depending on how page was loaded)
  if (window.history.length > 2) {
    navigate(-1);
    return;
  }
  
  // Priority 3: No history - use fallback path
  navigate(fallbackPath);
}, [navigate, fallbackPath, location.state]);
```

---

## Why This Fix Works

| Scenario | Old Behavior | New Behavior |
|----------|-------------|--------------|
| User clicks lead from Pipeline | `document.referrer` empty → fallback fails | `history.length > 2` → `navigate(-1)` ✅ |
| User directly opens lead URL | `document.referrer` empty → fallback | `history.length ≤ 2` → `/pipeline` fallback ✅ |
| User comes from Pipeline with state | `location.state.from` → `/pipeline` ✅ | Same ✅ |
| User refreshes the page | `document.referrer` points to old page | `history.length` may be reset → fallback ✅ |

---

## Additional Improvement

Also add `replace: true` when navigating to fallback to prevent creating a back-loop:

```typescript
navigate(fallbackPath, { replace: true });
```

This ensures if user lands directly on the page and clicks back, they go to Pipeline without being able to return to the lead page via browser back button.

---

## Testing Scenarios

After the fix, verify:
1. ✅ Navigate to lead from Pipeline → Back button returns to Pipeline
2. ✅ Navigate to lead from Contact Profile → Back button returns to Contact Profile  
3. ✅ Open lead URL directly (no history) → Back button goes to `/pipeline`
4. ✅ Browser back button still works normally
