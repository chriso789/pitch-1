

# Fix: Filter Master/Developer from All Rep Dropdowns

The duplicate "Chris O'Brien" is showing in the **ContactForm.tsx** rep dropdown (used on the client list page). This file fetches all profiles in the tenant with no role/developer filtering.

Two other files also need auditing:

| File | Current Filter | Fix Needed |
|------|---------------|------------|
| `ContactForm.tsx` | None | Add `role !== 'master'` and `is_developer !== true` filter |
| `LeadCreationDialog.tsx` | Filters `role !== 'master'` | Also add `is_developer` filter |
| `JobCreationDialog.tsx` | Filters by specific roles only | Already excludes master — add `is_developer` filter for safety |

## Changes

**`src/features/contacts/components/ContactForm.tsx`** (line 131-133):
- Add `.neq('role', 'master')` and `.neq('is_developer', true)` to the profiles query

**`src/components/LeadCreationDialog.tsx`** (line 245):
- The post-fetch filter already excludes `role !== 'master'` — also add `is_developer !== true`

**`src/components/JobCreationDialog.tsx`** (line 67-68):
- Already scoped to specific roles so master is excluded. Add `.neq('is_developer', true)` for safety.

