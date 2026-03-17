

# Fix: Contact Notes @Mentions Not Sending Notifications

## Root Cause

The **Contact Notes** section (`ContactNotesSection.tsx`) correctly extracts mentioned user IDs and saves them to the database, but **never invokes the `send-mention-notification` edge function**. This means no in-app notification, email, or SMS is sent when someone is @mentioned in a contact note.

The **Lead Details** internal notes (`InternalNotesSection.tsx`) does call the edge function — so mentions work there but not on the Contact Profile page.

## Fix

### `src/components/contact-profile/ContactNotesSection.tsx` (~lines 157-173)

After the successful `internal_notes` insert (line 169), add the same notification trigger that exists in `InternalNotesSection.tsx`:

```typescript
if (error) throw error;

// Send notifications to mentioned users
if (mentionedUserIds.length > 0) {
  try {
    await supabase.functions.invoke('send-mention-notification', {
      body: {
        contact_id: contactId,
        mentioned_user_ids: mentionedUserIds,
        author_id: user.id,
        note_content: newNote.trim(),
      }
    });
  } catch (notifyError) {
    console.error('Failed to send mention notifications:', notifyError);
  }
}

setNewNote('');
```

### `supabase/functions/send-mention-notification/index.ts`

The edge function currently expects `pipeline_entry_id` and uses it to look up the lead/contact for context. It needs a small update to also accept `contact_id` directly (for contact-level notes that aren't tied to a pipeline entry):

- Accept optional `contact_id` in the request body
- If `contact_id` is provided (and no `pipeline_entry_id`), fetch the contact directly from the `contacts` table for name/address context
- Keep existing `pipeline_entry_id` flow working as-is for lead notes

### Summary of changes
1. **`ContactNotesSection.tsx`** — Add the `send-mention-notification` invocation after note insert (same pattern as `InternalNotesSection.tsx`)
2. **`send-mention-notification/index.ts`** — Accept `contact_id` as an alternative to `pipeline_entry_id` for looking up lead context; fall back gracefully when neither provides a match

This is a two-file fix. No database changes needed.

