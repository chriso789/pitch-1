

## Plan: Build Text Blast Feature in Follow Up Hub

### Overview

Add a "Text Blast" tab to the Follow Up Hub (`CommunicationsHub.tsx`) that lets users select a contact list (reusing existing `dialer_lists`/`dialer_list_items` tables), write or pick a script, and send bulk SMS. The system will automatically honor opt-outs by checking the existing `opt_outs` table before sending, and the existing inbound STOP keyword handling in `messaging-inbound-webhook` already records opt-outs — so the "stop clause" is already wired on the receiving end.

### Database Changes

**New table: `sms_blasts`** — tracks each blast campaign:
- `id`, `tenant_id`, `created_by`, `list_id` (FK → dialer_lists), `name`, `script` (the message template), `status` (draft/sending/completed/cancelled), `total_recipients`, `sent_count`, `failed_count`, `opted_out_count`, `created_at`, `started_at`, `completed_at`

**New table: `sms_blast_items`** — per-recipient status:
- `id`, `blast_id` (FK → sms_blasts), `contact_id`, `phone`, `contact_name`, `status` (pending/sent/failed/opted_out/replied_stop), `sent_at`, `error_message`

RLS: tenant-scoped via `get_user_tenant_id()`.

### New Edge Function: `sms-blast-processor`

Processes a blast by:
1. Loading all `sms_blast_items` with status `pending` for the given blast
2. For each item, checking `opt_outs` table — if opted out, mark as `opted_out` and skip
3. Calling `telnyx-send-sms` for each non-opted-out contact with a short delay between sends (rate limiting)
4. Updating `sms_blast_items.status` and `sms_blasts` counters as it goes
5. Marking blast as `completed` when done

### UI Components

**1. New tab in `CommunicationsHub.tsx`**: "Text Blast" tab with a megaphone icon, added alongside the existing Inbox/SMS/Calls/Recordings/Email tabs.

**2. `TextBlastManager.tsx`** — Main component rendered in the tab:
- **Blast list view**: Shows existing blasts with status, sent/total counts, created date
- **Create new blast button** → opens creation flow

**3. `TextBlastCreator.tsx`** — Creation/edit form:
- **List selector**: Dropdown pulling from `dialer_lists` (same lists used by Power Dialer)
- **Script editor**: Textarea with variable support (`{{first_name}}`, `{{company_name}}`)
- **Script templates**: Quick-pick from saved scripts (stored in `sms_blasts` as reusable templates)
- **Preview**: Shows rendered message with sample data
- **Recipient count**: Shows total contacts in list, minus opt-outs
- **Opt-out notice**: Always appends "Reply STOP to opt out" to every message (TCPA compliance)
- **Send / Schedule buttons**

**4. `TextBlastDetail.tsx`** — Shows blast progress:
- Real-time sent/failed/opted-out counters
- Per-recipient status list
- Cancel button (sets remaining pending items to cancelled)

### Stop Clause Integration

The system already handles STOP replies via `messaging-inbound-webhook` → inserts into `opt_outs` table. The Text Blast processor checks `opt_outs` before each send. Additionally:
- Every blast message auto-appends "\nReply STOP to opt out" unless the script already contains "STOP"
- The blast detail view shows opted-out contacts clearly
- A manual "Add to opt-out" button on each recipient row

### Files to Create/Modify

1. **Migration SQL** — Create `sms_blasts` and `sms_blast_items` tables with RLS
2. **`supabase/functions/sms-blast-processor/index.ts`** — Edge function to process blast sends
3. **`src/components/communications/TextBlastManager.tsx`** — Blast list view
4. **`src/components/communications/TextBlastCreator.tsx`** — Create/edit blast form
5. **`src/components/communications/TextBlastDetail.tsx`** — Blast progress/detail view
6. **`src/pages/CommunicationsHub.tsx`** — Add "Text Blast" tab

### Technical Details

- Reuses existing `dialer_lists` / `dialer_list_items` for contact lists (no duplicate list management)
- Reuses existing `telnyx-send-sms` for actual delivery (location-aware from-number resolution)
- Reuses existing `opt_outs` table and `check_opt_out()` function for compliance
- The processor handles rate limiting (100ms delay between sends) to avoid carrier throttling
- Template variables resolved from `dialer_list_items.first_name`, `last_name`, and joined `contacts` data

