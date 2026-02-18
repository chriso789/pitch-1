

# Add Contact Status Dropdown to Contact Profile Header

## Problem
Nicole Walker shows "Unqualified" because her `qualification_status` field is `null` in the database. The current header displays this as a **static badge** with no way to change it. You need to be able to update the contact's qualification status directly from this page.

## Solution
Replace the static status badge (lines 228-244) with an interactive dropdown selector, similar to the "Assign Rep" dropdown already on this page. The dropdown will list all available contact statuses from the `useContactStatuses` hook and update the database on change.

## Changes

**File: `src/pages/ContactProfile.tsx`**

1. **Import `useContactStatuses` hook** -- This hook already exists and fetches the tenant's custom statuses (or defaults like Not Home, Interested, Qualified, Follow Up, etc.)

2. **Replace static Badge with a Select dropdown** -- Swap the current static `<Badge>` at line 228 for a `<Select>` component that:
   - Shows the current status (or "Unqualified" if null) with color coding
   - Lists all active statuses from `useContactStatuses()`
   - On change, calls `supabase.from('contacts').update({ qualification_status: newStatus })` 
   - Updates local state immediately for instant feedback
   - Shows a toast on success/error

3. **Add status update handler** -- A new `handleStatusChange` function similar to the existing `handleAssignRep`:
   ```
   const handleStatusChange = async (newStatus: string) => {
     const statusValue = newStatus === 'unqualified' ? null : newStatus;
     await supabase.from('contacts')
       .update({ qualification_status: statusValue })
       .eq('id', id);
     setContact(prev => ({ ...prev, qualification_status: statusValue }));
     // toast success
   };
   ```

The dropdown will sit in the same position as the current badge, maintaining the visual layout. Each status option will show its configured color dot for easy identification.

## Technical Details

| File | Change |
|------|--------|
| `src/pages/ContactProfile.tsx` | Import `useContactStatuses`; replace static Badge with Select dropdown; add `handleStatusChange` handler |

## Result
- The "Unqualified" badge becomes a clickable dropdown
- Selecting a status (e.g., "Qualified", "Interested") updates the contact immediately
- The database trigger `sync_contact_to_pipeline` will auto-create a pipeline entry if set to "Qualified" or "Interested"
- Color coding matches the status configuration
