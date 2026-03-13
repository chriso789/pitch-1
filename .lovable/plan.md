

# Mobile Field App — Full Implementation Plan

## Existing Infrastructure (No Rebuild Needed)
- **Offline stores**: `offlineManager.ts` (IndexedDB: routes, activityQueue, contacts, dispositions, satellite images, measurements) + `unifiedOfflineStore.ts` (photos, voice notes, leads, door knocks, sync log)
- **Offline sync hook**: `useOfflineSync.ts` with network monitoring
- **Push utilities**: `pushNotifications.ts` (VAPID-based web push)
- **Activity tracker**: `activityTracker.ts` (batched event logging to `user_activity_log`)
- **Mobile detection**: `mobileDetection.ts` (isMobileApp, isNativeWebView, etc.)
- **Mobile routes**: `/app/mobile`, `/deeplink`
- **Edge functions**: `mobile-session`, `register-mobile-device`, `mobile-upload`

---

## Phase 1: Database Tables (3 migrations)

### Migration 1: `job_alerts`
```sql
id uuid PK, company_id uuid FK tenants, user_id uuid FK auth.users,
job_id uuid nullable, alert_type text, title text, body text,
data_json jsonb, read_at timestamptz nullable, created_at timestamptz
```
RLS: users read/update own alerts only.

### Migration 2: `job_media`
```sql
id uuid PK, job_id uuid, company_id uuid, uploaded_by uuid,
file_url text, thumbnail_url text nullable, category text,
label text, metadata_json jsonb, created_at timestamptz
```
RLS: tenant-scoped read/write.

### Migration 3: `mobile_activity_logs`
```sql
id uuid PK, user_id uuid, company_id uuid, activity_type text,
entity_type text nullable, entity_id text nullable,
metadata_json jsonb, created_at timestamptz
```
RLS: users insert own, admins read all in tenant.

---

## Phase 2: Offline Cache & Sync Layer

### `src/lib/mobileCache.ts`
New IndexedDB database `pitchcrm-mobile-cache` with stores: `jobs`, `contacts`, `appointments`, `tasks`, `notes`, `documents`, `pendingSync`.

Functions: `cacheRecord`, `getCachedRecord`, `getCachedCollection`, `markPendingSync`, `getPendingSyncQueue`, `clearPendingSyncItem`.

Uses `idb` (already installed). Cache expiry: 24 hours. Network-first with cache fallback.

### `src/lib/mobileSyncManager.ts`
Wraps `mobileCache.ts` pending sync queue. Monitors online/offline state. On reconnect, processes queue in timestamp order. Supported actions: `create_note`, `update_job_status`, `create_task`, `upload_document_metadata`, `add_contact_log`, `save_measurement_note`. Each action maps to a direct Supabase client call (no batch endpoint needed — keeps it simpler and uses existing RLS).

Conflict resolution: compare `updated_at` — skip if server record is newer, otherwise overwrite.

### `src/hooks/useMobileCache.ts`
React hook wrapping mobileCache for use in components. Provides `cachedData`, `isOffline`, `pendingCount`.

---

## Phase 3: Edge Function — `send-job-alert`

### `supabase/functions/send-job-alert/index.ts`
- Accepts: `{ alert_type, user_id, job_id, title, body, data }`
- Inserts into `job_alerts` table
- Looks up user's `mobile_devices` records
- Constructs APNs/FCM payload (logs it for now; actual push sending deferred until APNs credentials are configured)
- Returns `{ success, alert_id }`
- `verify_jwt = false` with manual auth validation

---

## Phase 4: New Pages & Components

### `src/pages/MobileAlerts.tsx` — `/app/mobile/alerts`
- Lists alerts from `job_alerts` for current user
- Unread count badge
- Mark as read on tap
- Tap navigates to related entity via deep link routing
- Pull-to-refresh pattern

### `src/pages/MobileFieldMode.tsx` — `/app/mobile/field`
- Today's appointments card (query appointments where date = today)
- Assigned jobs card
- Quick actions row: take photo, add note, update status, call contact, navigate to property
- Status indicators: offline indicator, pending sync count, unread alerts count
- Recent uploads list
- Only shown when `isMobileApp()` or `isNativeWrapper()` returns true

### `src/pages/MobileJobPhotos.tsx` — `/app/mobile/jobs/:id/photos`
- Fetches from `job_media` table filtered by job_id
- Grouped by label/category
- Upload button calls existing `mobile-upload` edge function with extended metadata (category, label, GPS, capturedAt)
- Shows pending badge for unsynced items
- Tap for fullscreen preview

### `src/pages/MobileSettings.tsx` — `/app/mobile/settings`
- Toggle push alerts by type (stored in localStorage for now)
- Clear local mobile cache button
- Show pending sync count
- Show app version, logged-in user/company info
- FaceID toggle placeholder (native-side config)

### `src/components/mobile/MobileJobNoteComposer.tsx`
- Text input for note body
- Note type selector (general/inspection/sales/production/supplement)
- Saves to mobileCache immediately
- Shows `PendingSyncBadge` until synced
- On sync, inserts into existing notes/activity tables

### `src/components/mobile/PendingSyncBadge.tsx`
- Small badge showing "Pending sync" or "Synced" state
- Animated transition between states

---

## Phase 5: Bootstrap & Resume

### `src/lib/mobileBootstrap.ts`
`bootstrapMobileSession()` function:
1. Call `mobile-session` edge function to validate JWT
2. If invalid, redirect to `/login`
3. Refresh user profile context
4. Trigger `mobileSyncManager.processQueue()`
5. Fetch latest alerts count
6. Pre-cache next 10 jobs assigned to user

Called from `MobileEntry.tsx` on mount and from a `visibilitychange` event listener (handles app resume).

---

## Phase 6: Deep Link Expansion

Update `DeepLinkResolver.tsx` to handle:
- `pitchcrm://job/:id/photos` → `/app/mobile/jobs/:id/photos`
- `pitchcrm://job/:id/note/new` → `/job/:id?action=new-note`
- `pitchcrm://alerts` → `/app/mobile/alerts`
- `pitchcrm://tasks` → `/tasks`
- `pitchcrm://appointments/today` → `/calendar?view=today`
- `pitchcrm://field` → `/app/mobile/field`

---

## Phase 7: Mobile Activity Logging

### `src/lib/mobileActivityLogger.ts`
Lightweight wrapper that inserts into `mobile_activity_logs` table. Tracks: `mobile_login_restored`, `offline_note_created`, `pending_sync_processed`, `photo_uploaded`, `alert_opened`, `field_mode_opened`, `deep_link_navigated`.

Batches events and flushes every 30 seconds (similar pattern to existing `activityTracker.ts`).

---

## Phase 8: Route Registration

Add to `App.tsx`:
- `/app/mobile/field` → `MobileFieldMode`
- `/app/mobile/alerts` → `MobileAlerts`
- `/app/mobile/jobs/:id/photos` → `MobileJobPhotos`
- `/app/mobile/settings` → `MobileSettings`

All wrapped in `ProtectedRoute`.

---

## Files Summary

| Action | File |
|--------|------|
| Create | `src/lib/mobileCache.ts` |
| Create | `src/lib/mobileSyncManager.ts` |
| Create | `src/lib/mobileBootstrap.ts` |
| Create | `src/lib/mobileActivityLogger.ts` |
| Create | `src/hooks/useMobileCache.ts` |
| Create | `src/pages/MobileAlerts.tsx` |
| Create | `src/pages/MobileFieldMode.tsx` |
| Create | `src/pages/MobileJobPhotos.tsx` |
| Create | `src/pages/MobileSettings.tsx` |
| Create | `src/components/mobile/MobileJobNoteComposer.tsx` |
| Create | `src/components/mobile/PendingSyncBadge.tsx` |
| Create | `supabase/functions/send-job-alert/index.ts` |
| Create | 3 SQL migrations (job_alerts, job_media, mobile_activity_logs) |
| Modify | `src/pages/DeepLinkResolver.tsx` (expanded routes) |
| Modify | `src/pages/MobileEntry.tsx` (bootstrap integration) |
| Modify | `src/App.tsx` (4 new routes) |
| Modify | `supabase/config.toml` (register send-job-alert) |

