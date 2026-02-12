

## Fix: Edit Button Still Not Working

### Root Cause

Radix UI `TabsContent` **unmounts** the tab component when it's not active. When the user clicks "Edit" from another tab:

1. `triggerEditCounter` increments to e.g. `3`
2. Tab switches to "details", causing `ContactDetailsTab` to **mount fresh**
3. On mount, the ref initializes as `useRef(triggerEdit)` which equals `3`
4. The effect compares `triggerEdit (3) !== prevTriggerEdit.current (3)` -- they match, so nothing happens

The ref starts with the same value as the prop, so the effect never fires on mount.

### Fix

**File: `src/components/contact-profile/ContactDetailsTab.tsx` (line 60)**

Change the ref initialization from `useRef(triggerEdit)` to `useRef(0)`:

```typescript
// Before
const prevTriggerEdit = useRef(triggerEdit);

// After  
const prevTriggerEdit = useRef(0);
```

This way, when the component mounts fresh after a tab switch with `triggerEdit = 3`, the effect sees `3 !== 0` and correctly activates edit mode.

### Why This Is Safe

- On initial page load, `triggerEdit` starts at `0` and the ref starts at `0` -- they match, so edit mode won't activate unexpectedly
- When the user clicks Edit, the counter increments to `1+`, the component mounts, and the ref (at `0`) won't match -- edit mode activates correctly
- Subsequent clicks continue incrementing, always differing from the ref until it's updated

### Single Line Change

Only one line needs to change in `src/components/contact-profile/ContactDetailsTab.tsx`.

