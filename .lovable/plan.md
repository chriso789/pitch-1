
# Add Email Field to the "Add New Lead" Form

## Problem
The "Add New Lead" dialog (`EnhancedLeadCreationDialog.tsx`) has no email input, even though:
- The `formData` state doesn't include an `email` field
- The edge function `create-lead-with-contact` already accepts and handles `email` (dedup, contact creation)
- The `SelectedContact` interface already has `email`

## Changes

### `src/components/EnhancedLeadCreationDialog.tsx`

**1. Add `email` to formData state (line ~101)**
Insert `email: ""` into the initial formData object, right after `phone`.

**2. Add email input field in the left column (after Phone Number, around line ~669)**
Add an email input between Phone Number and Roof Age:
```tsx
<div>
  <Label htmlFor="email">Email</Label>
  <Input
    id="email"
    type="email"
    value={formData.email}
    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
    placeholder="Enter email address"
    disabled={formData.useSameInfo}
  />
</div>
```

**3. Pass email in handleSubmit body (line ~497)**
Add `email: formData.email` to the edge function call body.

**4. Reset email on form clear (line ~546)**
Add `email: ""` to the reset object.

**5. Pre-fill email from linked contact**
In the `useSameInfo` effect, set email from the selected contact when "Use same info" is checked.

## Technical Notes
- The field is optional (no asterisk, no validation required) -- email is not mandatory for lead creation
- The `create-lead-with-contact` edge function already handles email for dedup matching and contact record creation, so no backend changes are needed
- When "Use same info as contact" is checked, the email will auto-fill from the linked contact's record
