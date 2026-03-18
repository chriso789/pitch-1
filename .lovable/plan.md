

# Fix Mention Notification Links + Backfill Michael Grosso's Notifications

## Problems Found

1. **Email link 404**: The edge function `send-mention-notification` generates `linkPath = /contacts/${contact_id}` (line 87), but the actual route is `/contact/:id` (no "s"). This causes every contact mention email link to 404.

2. **Bell is empty**: The `user_notifications` table has zero mention records for Michael Grosso. The edge function has zero logs — it was likely never deployed, so the `supabase.functions.invoke('send-mention-notification')` calls from the frontend silently failed. The notes were saved (9 mentions from Chris O'Brien on March 17) but no notification records were created.

## Changes

### 1. Fix the link path in the edge function (`supabase/functions/send-mention-notification/index.ts`, line 87)

Change `/contacts/${contact_id}` → `/contact/${contact_id}` to match the actual route.

Also fix the `NotificationBell.tsx` click handler (line 50) which already uses `/contact/` — this is correct, no change needed there. But also check `NotificationToast.tsx` line 72 which uses `/contacts/` — fix that too.

### 2. Deploy the edge function

Redeploy `send-mention-notification` so future mentions actually trigger notifications.

### 3. Backfill Michael Grosso's notifications via migration

Insert 9 `user_notifications` records for each mention from March 17, using the actual note content and contact data already retrieved:

- tenant_id: `14de934e-7964-4afd-940a-620d2ace125d`
- user_id: `f828ec8a-07e9-4d20-a642-a60cb320fede` (Michael Grosso)
- type: `mention`
- title: `Chris O'Brien mentioned you`
- message: `On {ContactName} at {Address}: "{note_content}"`
- metadata: `{ author_id, contact_id, note_preview }`
- icon: `💬`
- is_read: false
- created_at: original note timestamp

### 4. Fix NotificationToast.tsx link

Change line 72 from `/contacts/` to `/contact/` to match the route.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/send-mention-notification/index.ts` | Fix linkPath from `/contacts/` to `/contact/` |
| `src/components/notifications/NotificationToast.tsx` | Fix navigation path from `/contacts/` to `/contact/` |
| New migration | Insert 9 backfill notification records for Michael Grosso |

