

# Fix: Quote Viewed Notification Not Appearing in Bell

## Root Cause

The `track-quote-view` edge function inserts a notification with `type: "quote_viewed"` (line 254), but the `user_notifications` table has a CHECK constraint that only allows these types:

```
rank_change, achievement_unlock, prize_zone, reward_ready, signature_received,
envelope_completed, envelope_viewed, mention, lead_hot, estimate_viewed,
proposal_signed, appointment_scheduled, deal_closed, security_alert
```

`quote_viewed` is **not** in that list, so the INSERT fails silently (the edge function doesn't check the insert result). Michael never gets the notification.

## Fix

### 1. Update the database CHECK constraint (migration)

Add `quote_viewed` to the allowed types in `user_notifications_type_check`:

```sql
ALTER TABLE user_notifications DROP CONSTRAINT user_notifications_type_check;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_type_check
  CHECK (type = ANY (ARRAY[
    'rank_change','achievement_unlock','prize_zone','reward_ready',
    'signature_received','envelope_completed','envelope_viewed',
    'mention','lead_hot','estimate_viewed','proposal_signed',
    'appointment_scheduled','deal_closed','security_alert',
    'quote_viewed'
  ]));
```

### 2. Add `quote_viewed` handling to the notification UI components

Update three files to recognize and render `quote_viewed` notifications:

- **NotificationBell.tsx**: Add icon mapping (`👁️`)
- **NotificationToast.tsx**: Add icon + variant for `quote_viewed`
- **RealTimeNotificationProvider.tsx**: Add `quote_viewed` to the type union and add a toast case
- **NotificationsPage.tsx**: Add icon and label mappings

### 3. Add error logging in the edge function

Add a check after the notification insert (line 247-263) so failures are logged instead of silently swallowed.

## Files Changed

| File | Change |
|------|--------|
| New migration | Add `quote_viewed` to type CHECK constraint |
| `src/components/notifications/NotificationBell.tsx` | Add `quote_viewed` icon |
| `src/components/notifications/NotificationToast.tsx` | Add `quote_viewed` icon |
| `src/components/notifications/RealTimeNotificationProvider.tsx` | Add type + toast case |
| `src/pages/NotificationsPage.tsx` | Add icon + label |
| `supabase/functions/track-quote-view/index.ts` | Log insert errors |

