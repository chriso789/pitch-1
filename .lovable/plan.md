

# Fix: Edit Button Appears Non-Functional on Contact Profile

## Problem
The Edit button in the contact profile header does work -- it switches to the Details tab and enables editing mode. However, the edit form is inside the "Contact Information" card which sits far below the header (after Pipeline cards, Quick Stats, Homeowner Portal Access, etc.). Since the page does not scroll to the form, the user sees no visible change and assumes the button is broken.

## Root Cause
`ContactDetailsTab.tsx` sets `isEditing = true` when `triggerEdit` changes, but there is no `scrollIntoView()` call to bring the edit form into the viewport.

## Changes

### `src/components/contact-profile/ContactDetailsTab.tsx`

**Add a ref to the Contact Information card and scroll to it when edit is triggered:**

1. Add a `useRef` for the edit section (the "Contact Information" card around line 345)
2. In the existing `useEffect` that responds to `triggerEdit` (lines 62-67), after setting `isEditing(true)`, call `scrollIntoView` with a small delay to allow the DOM to update:

```typescript
const editSectionRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (triggerEdit > 0 && triggerEdit !== prevTriggerEdit.current) {
    setIsEditing(true);
    prevTriggerEdit.current = triggerEdit;
    // Scroll the edit form into view after a brief delay for render
    setTimeout(() => {
      editSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}, [triggerEdit]);
```

3. Attach the ref to the "Contact Information" card:
```tsx
<Card className="shadow-soft" ref={editSectionRef}>
```

## Result
Clicking the header "Edit" button will smoothly scroll the page down to the Contact Information card, which is now in edit mode with all form fields visible. The user gets immediate visual feedback that the button worked.
