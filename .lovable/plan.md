

# Fix @Mention Notifications in Bell + Email

## Problems Found

1. **Edge function inserts `action_url`** — but that column doesn't exist on `user_notifications`, causing the insert to silently fail. No in-app notifications are actually created.
2. **RealTimeNotificationProvider maps wrong column names** — reads `n.notification_type` but column is `type`; reads `n.read` but column is `is_read`. Mention notifications would never render correctly even if they were inserted.
3. **NotificationBell doesn't handle `mention` type** — no icon, no click-to-navigate for mention notifications.
4. **NotificationToast doesn't handle `mention` type** — no icon or styling for mention toast popups.

## Fix Plan

### 1. Fix edge function (`supabase/functions/send-mention-notification/index.ts`)
- Remove `action_url` from the insert (column doesn't exist)
- Move the `pipeline_entry_id` into `metadata` so the UI can navigate to the lead

```ts
// Line 89-97: Remove action_url, add pipeline_entry_id to metadata
supabase.from('user_notifications').insert({
  tenant_id: ...,
  user_id: user.id,
  type: 'mention',
  title: `${authorName} mentioned you`,
  message: `On lead ${leadName}...`,
  icon: '💬',
  metadata: {
    author_id,
    pipeline_entry_id,
    note_preview: truncatedNote,
  },
})
```

Then redeploy the edge function.

### 2. Fix RealTimeNotificationProvider column mapping
- `n.notification_type` → `n.type`
- `n.read` → `n.is_read`
- Add `mention` case to `handleNewNotification` for toast display

### 3. Add `mention` type to NotificationBell
- Add `'mention': '💬'` to icon map
- Handle click navigation: if `data.pipeline_entry_id`, navigate to `/lead/{id}`

### 4. Add `mention` type to NotificationToast
- Add `mention` case with a message icon and `'info'` variant styling

### Files Changed
- `supabase/functions/send-mention-notification/index.ts` — remove `action_url`, fix insert
- `src/components/notifications/RealTimeNotificationProvider.tsx` — fix column mapping, add mention toast
- `src/components/notifications/NotificationBell.tsx` — add mention icon + navigation
- `src/components/notifications/NotificationToast.tsx` — add mention icon

### Deployment
- Redeploy `send-mention-notification` edge function after code changes

