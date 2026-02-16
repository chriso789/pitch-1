
# Fix: "Cannot access handleEnrich before initialization" Crash

## Root Cause

`handleEnrich` is defined as a `const` function on **line 180**, which is *after* the early return on **line 137**. However, the `useEffect` on **line 72** calls `handleEnrich()` on line 98. Due to JavaScript's temporal dead zone (TDZ), a `const` variable cannot be accessed before its declaration -- so when the effect fires, `handleEnrich` does not yet exist in scope, causing the crash.

## Fix

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

Move the `handleEnrich` function definition (currently starting at line 180) to **before** the `useEffect` that calls it (line 72). Specifically, place it right after the state declarations and refs (after line 69), and wrap it in `useCallback` so the reference is stable:

1. Convert `handleEnrich` (lines 180-277) from a plain `const` function to a `useCallback` wrapped function
2. Move it to just before line 72 (the auto-enrich useEffect)
3. Add `handleEnrich` to the useEffect dependency array on line 100

This ensures `handleEnrich` is declared before any code attempts to reference it, eliminating the TDZ crash entirely.

## Technical Details

```
Before (broken ordering):
  Line 69:  const [localProperty, ...] = useState(...)
  Line 72:  useEffect(() => { handleEnrich(); })   <-- references handleEnrich
  Line 137: if (!property) return null;             <-- early return
  Line 180: const handleEnrich = async () => {...}  <-- defined AFTER the useEffect

After (fixed ordering):
  Line 69:  const [localProperty, ...] = useState(...)
  Line 71:  const handleEnrich = useCallback(async () => {...}, [deps])
  Line ~150: useEffect(() => { handleEnrich(); }, [open, property?.id, handleEnrich])
  Line ~160: if (!property || !localProperty) return null;
```
