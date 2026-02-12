

## Add Edit Button to Contact Details Page Header

### What's Changing

Adding an "Edit" button next to the existing Call, Skip Trace, and Create Lead buttons in the contact profile header. Clicking it will scroll to the Details tab and activate the edit mode on the Contact Information card.

### Technical Details

**File: `src/pages/ContactProfile.tsx`**

1. Add a new `Edit` button in the header action buttons area (around line 205-230), styled consistently with the existing buttons
2. When clicked, it will:
   - Switch to the "details" tab (`setActiveTab("details")`)
   - Set a new state flag `triggerEdit` to `true`
3. Pass `triggerEdit` as a prop to `ContactDetailsTab`
4. Reset `triggerEdit` after it's consumed

**File: `src/components/contact-profile/ContactDetailsTab.tsx`**

1. Accept a new optional prop `triggerEdit?: boolean`
2. Add a `useEffect` that watches `triggerEdit` -- when it becomes `true`, set `isEditing` to `true` (activating the inline edit form)

### Result

Users will see an Edit button prominently in the contact header. Clicking it switches to the Details tab and immediately opens the edit form for the contact's information.
