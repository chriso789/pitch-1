

# Fix: Crash When Opening a Pin (null localProperty)

## Root Cause

On line 67 of `PropertyInfoPanel.tsx`, `localProperty` is initialized with:
```typescript
const [localProperty, setLocalProperty] = useState<any>(property);
```

When the component first mounts with `property = null`, `localProperty` is also `null`. The early return on line 135 checks `if (!property) return null;` but lines 146-165 access `localProperty.searchbug_data`, `localProperty.phone_numbers`, etc. -- which crashes because `localProperty` is still `null`.

This is because React `useState` only uses its initial value on the **first render**. When `property` later becomes non-null, `localProperty` stays `null` until the `useEffect` on line 101 fires (which happens **after** the render attempt).

## Fix

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

1. Expand the early return on line 135 to also check `localProperty`:
```typescript
if (!property || !localProperty) return null;
```

This is a one-line change that prevents the crash entirely. When `property` becomes available and `localProperty` syncs via the useEffect, the component will re-render with valid data.

## Why This is Safe

- The `useEffect` on line 101 already syncs `localProperty` from `property` whenever `property.id` changes
- On the very next render cycle after `property` becomes non-null, `localProperty` will also be non-null
- All hooks are called before this early return (lines 57-132), so React's rules of hooks are satisfied

