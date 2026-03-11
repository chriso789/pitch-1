

# Fix: "Create Lead" from Contact Profile Not Working

## Problem
When clicking "Create Lead" from a contact profile page, the `LeadCreationDialog` pre-fills name, phone, and address from the contact — but the submit button stays disabled because **roof age** and **roof type** are required fields that aren't available on the contact record. The button shows "Complete Required Fields" and the user can't submit without filling those in first.

This is a UX friction issue: when you already have a contact and just want to create a lead for them, you shouldn't be blocked by roof details that can be added later on the lead details page.

## Solution
Make `roofAge` and `roofType` **optional** when creating a lead from an existing contact (i.e., when the `contact` prop is provided). These fields can be filled in later on the lead details page.

### Changes — `src/components/LeadCreationDialog.tsx`

1. **Update `isFormValid` memo** (~line 348): When `contact` is provided, skip the `roofAge` and `roofType` checks
2. **Update `validateForm` function** (~line 380): Same conditional — skip roof validation when `contact` exists
3. **Update form UI**: When `contact` is provided, remove the "required" indicator from roof age/type fields and show them as "optional"

```tsx
// In isFormValid and validateForm:
const roofRequired = !contact; // Only required for new contacts

// Validation checks become:
roofAge: roofRequired ? (!!formData.roofAge && ...) : true,
roofType: roofRequired ? !!formData.roofType : true,
```

This way:
- Creating a lead from scratch (no contact) still requires roof details
- Creating a lead from an existing contact profile lets you skip them

### Files Changed
- `src/components/LeadCreationDialog.tsx` — make roof fields optional when contact is provided

