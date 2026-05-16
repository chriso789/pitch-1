
# Telnyx SMS Blast — Production Build (no parallel tables)

## Audit of what already exists

Tables (keep, extend only):
- `sms_blasts`, `sms_blast_items`, `sms_messages`, `sms_threads`
- `opt_outs` (tenant_id, contact_id, channel, phone, email, reason)
- `unmatched_inbound` (tenant_id, location_id, channel, from_e164, to_e164, …)
- `telnyx_webhook_events` (tenant_id, kind, event_type, telnyx_event_id, payload)
- `locations` (telnyx_phone_number, telnyx_messaging_profile_id)
- `phone_number_routing` (system_number, telnyx_messaging_profile_id, is_active)
- `messaging_providers`

Edge functions (keep, refactor):
- `telnyx-send-sms` (420 lines) — canonical outbound sender
- `sms-blast-processor` (183 lines) — current worker, needs throttling rewrite
- `telnyx-sms-status-webhook` — delivery receipts
- `asterisk-sms-inbound` — currently only inbound path; we need a Telnyx-native one

No `phone_numbers` or `telnyx_numbers` table — the Telnyx number registry lives on `locations` + `phone_number_routing`. **We will add throughput/limit fields there, not create a new table.**

No cron is currently scheduled for `sms-blast-processor`.

## Step 1 — Schema migration (extend only)

```sql
-- sms_blasts: throughput + outcome tracking
alter table sms_blasts
  add column if not exists target_window_minutes int default 30,
  add column if not exists required_messages_per_second numeric,
  add column if not exists actual_messages_per_second numeric,
  add column if not exists last_processor_run_at timestamptz,
  add column if not exists failure_rate numeric default 0,
  add column if not exists delivery_rate numeric default 0,
  add column if not exists reply_rate numeric default 0,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

-- sms_blast_items: per-recipient claim + delivery state
alter table sms_blast_items
  add column if not exists telnyx_message_id text,
  add column if not exists from_number text,
  add column if not exists delivered_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists last_error text,
  add column if not exists claimed_at timestamptz,
  add column if not exists attempt_count int default 0;

create unique index if not exists sms_blast_items_telnyx_msg_uq
  on sms_blast_items(telnyx_message_id) where telnyx_message_id is not null;

-- locations: per-number messaging throughput
alter table locations
  add column if not exists messages_per_second numeric default 1,
  add column if not exists telnyx_phone_number_id text,
  add column if not exists supports_sms boolean default true,
  add column if not exists supports_voice boolean default true,
  add column if not exists current_day_sent int default 0,
  add column if not exists current_day_reset_at date,
  add column if not exists daily_limit int default 1000,
  add column if not exists tendlc_campaign_status text;

-- sms_messages: backfill column the webhook needs
alter table sms_messages
  add column if not exists campaign_id uuid,
  add column if not exists blast_id uuid references sms_blasts(id);
```

RLS already exists on all of these tables; no new policies needed beyond what's there.

## Step 2 — Refactor `telnyx-send-sms` (single sender, no duplicates)

Keep it as the **only** outbound path. AI Follow-Up Queue, single replies, blast worker, sms-auto-responder all call this. Behavior:
1. Validate body → E.164.
2. Look up `opt_outs` (tenant_id + normalized phone, channel='sms'). If hit → return 409 `{ blocked:true, reason:'opted_out' }` and mark caller's row.
3. Resolve `from_number`:
   - if `from_number` passed, verify it belongs to tenant via `locations` or `phone_number_routing`.
   - else pick least-loaded active SMS number for tenant.
4. Insert `sms_messages` row (direction=outbound, status=queued, blast_id/contact_id/thread_id).
5. POST to `https://api.telnyx.com/v2/messages` with `use_profile_webhooks:true`.
6. Update `sms_messages` with `telnyx_message_id`, status=`sent_to_provider`, raw response.
7. Increment `locations.current_day_sent` (reset on day rollover).
8. Return `{ ok, sms_message_id, telnyx_message_id }`.

## Step 3 — Rewrite `sms-blast-processor` (throughput-aware)

Pacing model: **pg_cron every 1 minute**, claim-and-send per tick.

```text
per tick (per running blast):
  capacity_per_minute = sum(active SMS locations.messages_per_second) * 60
  recipients = atomic claim of next N pending sms_blast_items
               where N = min(capacity_per_minute, remaining)
  for each recipient (sequentially, sleep = 1000ms / total_mps):
    call telnyx-send-sms
    update sms_blast_items: status, telnyx_message_id, from_number, attempt_count
  recompute failure_rate; if > 10% → mark blast 'failed', circuit-break
  update last_processor_run_at, actual_messages_per_second
  if no remaining → status='completed', completed_at=now()
```

Atomic claim (prevents double-send across overlapping ticks):
```sql
update sms_blast_items
set status='claimed', claimed_at=now(), attempt_count=attempt_count+1
where id in (
  select id from sms_blast_items
   where blast_id=$1 and status in ('pending')
   order by created_at limit $2
   for update skip locked
) returning *;
```

Skip recipients whose phone is in `opt_outs` (suppression query in same claim CTE) and mark them `opted_out`.

Idempotency: never re-claim rows with non-null `telnyx_message_id`. Admin retry of `failed` rows resets to `pending`.

## Step 4 — Telnyx delivery webhook (`telnyx-sms-status-webhook`)

- Verify Telnyx signature (`Telnyx-Signature-Ed25519` + `Telnyx-Timestamp`, public key from secret).
- Insert raw event into `telnyx_webhook_events`.
- Find `sms_messages` by `telnyx_message_id`; map event_type to status:
  - `message.sent` → `sent`
  - `message.delivered` → `delivered` + `delivered_at`
  - `message.finalized` (failed/undelivered) → `failed` + `last_error`
- Mirror to `sms_blast_items` (same `telnyx_message_id`).
- Recompute `sms_blasts.delivery_rate` / `failure_rate` (trigger or in-function).

## Step 5 — New `telnyx-inbound-webhook` (replaces asterisk path for Telnyx)

- Verify signature.
- Normalize `from`/`to` to E.164.
- Resolve tenant via `locations.telnyx_phone_number = to` OR `phone_number_routing.system_number = to`.
- If body matches `/^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)$/i`:
  - upsert `opt_outs (tenant_id, phone=from, channel='sms', reason=body)`.
  - mark any pending `sms_blast_items` for that phone as `opted_out`.
  - send compliant confirmation reply.
- Match contact: `contacts.tenant_id = tenant AND normalize(phone|mobile_phone|secondary_phone) = from`.
- If matched:
  - upsert `sms_threads` (tenant_id, contact_id, location_id).
  - insert `sms_messages` (direction=inbound, thread_id, from/to, body, telnyx_message_id).
  - if this `from` had a recent outbound blast item, set `sms_blast_items.replied_at`.
- If unmatched: insert `unmatched_inbound`.
- Always insert raw payload into `telnyx_webhook_events`.

## Step 6 — Health check edge function `telnyx-health-check`

Returns a structured report used by `TextBlastCreator` and a new `Settings → SMS Health` page:
- `TELNYX_API_KEY` present
- Tenant has ≥1 active SMS-capable location with `telnyx_phone_number` + `telnyx_messaging_profile_id`
- Sum `messages_per_second` across active numbers
- For a target N recipients in W minutes: required mps = N/(W*60), estimated_completion_minutes, warning if capacity < required
- 10DLC campaign status per number (from existing `telnyx-10dlc` data)
- Telnyx GET `/v2/messaging_profiles/{id}` to verify inbound + delivery webhook URLs
- `opt_outs` table reachable
- pg_cron `sms-blast-processor` schedule exists

## Step 7 — Cron schedule

Migration adds (or replaces) every-minute job:
```sql
select cron.schedule(
  'sms-blast-processor-every-minute', '* * * * *',
  $$ select net.http_post(
       url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/sms-blast-processor',
       headers := jsonb_build_object('Content-Type','application/json',
                                     'Authorization','Bearer <SERVICE_ROLE_KEY>')
     ); $$
);
```

If `pg_cron` isn't enabled, expose "Run Worker Now" button in `TextBlastDetail` and document fallback.

## Step 8 — UI work (existing pages, no new tables)

- `TextBlastCreator`: pre-send health check banner (capacity, required mps, ETA, warning).
- `TextBlastDetail`: live counters (sent / delivered / failed / replied / opted-out / remaining), current pacing, ETA remaining, **Run Worker Now**, **Cancel Blast**, **Resume**.
- Contact timeline: already pulls `sms_messages`; just confirm `delivered_at` and inbound rows render.
- New `/settings/sms-health` page wrapping `telnyx-health-check`.
- AI Follow-Up Queue: replace any direct fetch with `supabase.functions.invoke('telnyx-send-sms', ...)` so there's one outbound path.

## Step 9 — Live test plan (your number)

Test mode flag on `sms_blasts.is_test_mode` (add column). Test mode:
- accepts only an allow-list of phone numbers (seeded with `+17708420812`)
- bypasses cron, runs synchronously, returns full diagnostic JSON

Test sequence:
1. Health check → green.
2. Send 1 outbound to +17708420812 → verify `sms_messages.status` progresses queued → sent → delivered.
3. Reply "TEST" from your phone → verify `sms_messages` inbound row + thread + contact link.
4. Reply "STOP" → verify `opt_outs` row + suppression on next send (must 409).
5. Create 10-recipient test blast (all internal test numbers) → verify all 10 delivered + UI counters.
6. Only after all green → 5,000 production blast.

## Throughput math (surfaced in UI)

For 5,000 in 30 min: required = 2.78 msg/s.
- 1 num @ 1 mps → ~83 min
- 2 → ~42 min
- 3 → ~28 min ✅
- 4 → ~21 min

Health check **blocks** the 5,000 blast unless aggregate mps ≥ 3 (configurable).

## What I will NOT do

- Will not create `sms_campaigns`, `sms_campaign_recipients`, `telnyx_numbers`, `sms_opt_outs`, `sms_delivery_events`, `company_messaging_settings`. Existing tables cover all of these.
- Will not duplicate the sender. `telnyx-send-sms` stays the only outbound function.
- Will not invent fake data or seed dummy numbers.

## Deliverables order

1. Migration (Step 1 + Step 7 cron).
2. Refactor `telnyx-send-sms`.
3. Rewrite `sms-blast-processor` with claim + pacing + circuit breaker.
4. Refactor `telnyx-sms-status-webhook` (signature + blast_item mirror).
5. New `telnyx-inbound-webhook` (signature + STOP + contact match).
6. New `telnyx-health-check`.
7. UI: TextBlastCreator banner, TextBlastDetail controls, `/settings/sms-health`, AI Follow-Up routing fix.
8. Live test to +17708420812 per Step 9.
