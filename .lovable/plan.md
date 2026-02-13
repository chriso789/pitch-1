
## Fix: Contact Search Not Finding Existing Contacts

### Root Cause

The "Link to Contact" search in the Add Lead dialog uses `userProfile?.tenant_id` to filter contacts. However, when you've switched companies (e.g., to "Under One Roof"), the active company is stored in `active_tenant_id`, not `tenant_id`. So the search queries the wrong company's contacts and returns "No contacts found."

The sales reps loader already handles this correctly (line 292: `active_tenant_id || tenant_id`), but the contact search prop does not.

### Fix

**File: `src/components/EnhancedLeadCreationDialog.tsx`** -- line 608

Change the `tenantId` prop from:
```
tenantId={userProfile?.tenant_id}
```
to:
```
tenantId={userProfile?.active_tenant_id || userProfile?.tenant_id}
```

This is a one-line fix. No other files need changes -- the `ContactSearchSelect` component already correctly applies the `tenant_id` filter when the prop is provided.

### Verification

After this fix, searching "fred" in the Add Lead dialog while switched to "Under One Roof" will find "Fred Lester" (confirmed present in database).
