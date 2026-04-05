

## Communications & Dialer — Production Readiness Plan

### Current State Summary

The Communications stack has real infrastructure (Telnyx keys, Resend, 10DLC support) and real data (12 calls, 3 text blasts, 5 dialer lists, 1 SMS thread). Bridge-dial calling works. But many pieces are scaffolded UI with gaps that prevent daily production use.

### What Needs to Be Fixed/Built (grouped by impact)

---

### Group A: Call Center & Power Dialer (highest priority)

1. **Recording permanence** — Call recordings use expiring Telnyx S3 URLs (600s TTL). The webhook *should* download and re-upload to Supabase Storage, but `call_recordings` has 0 rows. Fix the `telnyx-call-webhook` to reliably persist recordings to the `call-recordings` bucket and populate `call_recordings`.

2. **Transcription pipeline** — All 12 calls have `transcript: null`. Wire the `voice-transcribe` edge function to run after recording upload, storing the transcript on the `calls.transcript` column.

3. **Dialer list ↔ call linking** — `list_item_id` is null on all calls. When a call is initiated from the live dialer, pass the `list_item_id` through so call history links back to the list and item status updates to `called`.

4. **Call disposition persistence** — After disposition in the live dialer, update the `dialer_list_items.status` and log the disposition to `dialer_dispositions` so the list builder accurately reflects contacted vs. pending.

5. **Voicemail drop completion** — `voicemail_templates` table exists but there is no `voicemail_recordings` table for dropped voicemails. Create the table and wire `telnyx-voicemail-drop` to store the result, then surface it in the call log.

6. **Call log in Follow Up Hub** — The Call Center page has its own call log, but the Unified Inbox (`unified_inbox` table) has 0 rows. Write a trigger or post-call hook that inserts completed calls into `unified_inbox` so the Follow Up Hub shows call activity alongside SMS.

---

### Group B: SMS & Messaging

7. **Inbound SMS → thread sync** — The `telnyx-sms-status-webhook` and `messaging-inbound-webhook` need to reliably create/update `sms_threads` and insert into `sms_messages`. Currently only 1 thread exists from a text blast; inbound replies are likely not being captured.

8. **SMS delivery status tracking** — Wire `telnyx-sms-status-webhook` to update `sms_messages.delivery_status` with Telnyx DLR events (delivered/failed/undelivered) so the conversation thread shows accurate delivery indicators.

9. **Opt-out enforcement** — `opt_outs` has 0 rows. Ensure inbound "STOP" keyword handling in `messaging-inbound-webhook` inserts into `opt_outs` and that `sms-blast-processor` and `telnyx-send-sms` check it before sending.

10. **Unmatched inbound routing** — `unmatched_inbound` has 0 rows. Verify that when an inbound SMS/call doesn't match a contact phone, it lands in `unmatched_inbound` so the Unmatched Inbox page actually populates.

11. **Thread-level contact linking** — When a contact replies from a number that matches a blast recipient, auto-link the `sms_threads.contact_id` so the thread shows the contact name instead of just a phone number.

---

### Group C: Unified Inbox & AI Queue

12. **Unified inbox population** — Build triggers/hooks so that every inbound SMS, call, and voicemail automatically creates a row in `unified_inbox`. Right now it's empty, making the Follow Up Hub's inbox tab useless.

13. **AI Follow-up queue hydration** — `ai_outreach_queue` has 0 rows. Wire the `ai-followup-dispatch` function to actually schedule follow-ups based on pipeline activity (e.g., lead not contacted in 48h → auto-queue SMS/call).

14. **AI auto-responder for inbound SMS** — The `sms-auto-responder` edge function exists. Verify it's deployed and connected to the inbound webhook, then add a tenant-level on/off toggle in the AI Queue settings.

---

### Group D: Email Activity

15. **Email tracking webhook** — `EmailActivityDashboard` expects email status data. Wire the Resend webhook (`resend-webhook`) to update email delivery/open/click status in a tracked emails table so the dashboard shows real data.

---

### Group E: Infrastructure & Reliability

16. **Webhook idempotency** — Add idempotency checks (dedupe by Telnyx event ID) to `telnyx-call-webhook` and `telnyx-sms-status-webhook` to prevent duplicate rows from retried webhook deliveries.

17. **Error alerting** — When edge functions fail (call webhook, SMS send), log to a `system_errors` or `edge_function_errors` pattern and surface critical failures in the admin monitoring page.

18. **RLS policy audit** — Verify `sms_threads`, `sms_messages`, `unified_inbox`, `calls`, `call_recordings`, `dialer_lists`, `dialer_list_items` all have proper tenant-scoped RLS so Company A cannot see Company B's communications.

19. **10DLC status display** — The 10DLC registration manager exists in admin. Verify it accurately reflects registration status and blocks SMS sending for unregistered numbers with a clear user-facing message.

20. **Real-time updates** — Add Supabase Realtime subscriptions to `sms_threads`, `unified_inbox`, and `calls` so new inbound messages/calls appear instantly without manual refresh.

---

### Implementation Order

| Phase | Items | Scope |
|-------|-------|-------|
| **Phase 1** (this session) | 1-6 | Call recording, transcription, dialer data flow |
| **Phase 2** (next session) | 7-11 | SMS reliability, delivery tracking, opt-outs |
| **Phase 3** | 12-14 | Unified inbox + AI queue wiring |
| **Phase 4** | 15-20 | Email tracking, infra hardening, real-time |

### Files to Create/Modify

**Edge Functions:**
- `supabase/functions/telnyx-call-webhook/index.ts` — recording download + storage upload
- `supabase/functions/voice-transcribe/index.ts` — post-recording transcription
- `supabase/functions/telnyx-sms-status-webhook/index.ts` — DLR status updates
- `supabase/functions/messaging-inbound-webhook/index.ts` — thread creation, unmatched routing, STOP handling

**Database:**
- Migration: create `voicemail_recordings` table
- Migration: add triggers to populate `unified_inbox` from SMS/calls
- RLS audit on communication tables

**Frontend:**
- `src/components/call-center/CallCenterLiveDialer.tsx` — pass `list_item_id`, fix disposition save
- `src/hooks/useCommunications.ts` — add Realtime subscriptions
- `src/components/communications/UnifiedInbox.tsx` — real-time refresh

### Technical Details

- Recording persistence: download Telnyx S3 URL within the 600s TTL window, upload to `supabase.storage.from('call-recordings')`, store the permanent public URL on `call_recordings.recording_url`
- Transcription: use OpenAI Whisper API (key already configured) via the `voice-transcribe` function
- Unified inbox triggers: Postgres `AFTER INSERT` triggers on `sms_messages` (direction='inbound') and `calls` (status='completed') that insert into `unified_inbox`
- Realtime: subscribe to `sms_threads` and `unified_inbox` changes filtered by `tenant_id`

