

## Fix: Edit Button Not Working

### Root Cause

There's a race condition between two `useEffect` hooks in `ContactDetailsTab.tsx`:

1. The **triggerEdit** effect (line 63) sets `isEditing = true`
2. The **contact reset** effect (line 122-128) sets `isEditing = false` whenever the contact is present

Both run when the component mounts/re-renders after the tab switch, and the reset effect wins, immediately turning off edit mode.

### Fix

**File: `src/components/contact-profile/ContactDetailsTab.tsx` (line 122-128)**

Modify the contact reset effect to only reset `isEditing` when the contact ID actually *changes* (not on initial mount or re-render with the same contact):

```typescript
const prevContactId = useRef(contact?.id);

useEffect(() => {
  if (contact) {
    form.reset(getFormDefaults(contact));
    // Only reset editing state when contact actually changes
    if (prevContactId.current !== contact.id) {
      setIsEditing(false);
      prevContactId.current = contact.id;
    }
  }
}, [contact?.id]);
```

This ensures the reset only fires when navigating between contacts, not when switching tabs on the same contact.

### Result

Clicking the Edit button will reliably switch to the Details tab and activate the inline edit form.

