

# Unified "Edit Lead Details" Dialog — All Fields in One Place

## Problem
The Edit dialog only has project fields (Priority, Roof Type, Roof Age, Est. Value). There's no way to edit the contact's name, email, or phone from this page.

## Changes

### `src/components/lead-details/EditProjectDetailsDialog.tsx`
- **Add props**: `contactId`, `initialContactValues` (first_name, last_name, email, phone)
- **Add fields** at the top of the form: First Name, Last Name, Email, Phone
- **Save logic**: Update `contacts` table with name/email/phone, then update `pipeline_entries` with project fields — both in the same save handler
- **Rename dialog title** to "Edit Lead Details"

### `src/pages/LeadDetails.tsx`
- **Pass contact data** to the dialog: `contactId={lead.contact?.id}`, `initialContactValues={{ first_name, last_name, email, phone }}`
- **Move Edit button** from inside the stats bar to the header row (next to the contact name), so it's a single prominent "Edit" that covers everything

