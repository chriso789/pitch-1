# Messaging Domain Consolidation Report

Generated: 2026-05-22 (Phase 1, messaging domain)

## Routes created (real handlers, not 501)

### messaging-api (authenticated, tenant-scoped)
- `POST /sms/send` — single outbound SMS (delegates to `telnyx-send-sms`)
- `POST /sms/send-legacy` — back-compat path for original `send-sms` shape
- `POST /sms/reply` — thread reply (delegates to `sms-send-reply`)
- `POST /sms/blast/start` — UI kick of blast processor
- `POST /sms/blast/preview` — dry-run preview render
- `POST /sms/templates/render` — merge-var render (delegates to `communication-template-engine`)
- `POST /sms/dnc/check` — direct `opt_outs` lookup, no legacy call needed
- `POST /communication/send` — multi-channel fan-out (delegates to `send-communication`)
- `GET  /conversations/:contact_id` — direct `sms_messages` read
- `POST /conversations/:contact_id/message` — thread send
- `POST /ai/sms-response` — AI reply (delegates to `sms-conversation-ai`)

### messaging-worker (service-role OR x-internal-secret)
- `POST /blast/process` — sms-blast-processor tick
- `POST /queue/process` — messaging-queue-processor tick
- `POST /followup/process` — ai-followup-worker (SMS path)
- `POST /delivery/retry` — re-kick stuck blast items
- `POST /dnc/scrub-batch` — inline `opt_outs` batch lookup

### messaging-webhook (public, signature-validated by delegated legacy fns)
- `POST /telnyx/inbound` — delegates to `telnyx-inbound-webhook` (sig verified there)
- `POST /telnyx/status` — delegates to `telnyx-sms-status-webhook`
- `POST /telnyx/call-event` — delegates to `telnyx-call-webhook`
- `POST /generic/inbound` — delegates to `messaging-inbound-webhook`
- `POST /__sig_failure` — internal logger hook

## Old functions migrated (now reachable via grouped routes)

These legacy functions are now invoked through `messaging-api` / `messaging-worker` / `messaging-webhook`. Their code is **unchanged** in this loop; only the entrypoint moved. Logic will be ported inline in a follow-up loop, after which these folders become deletable.

| Legacy function | New route | Notes |
|---|---|---|
| `telnyx-send-sms` | `messaging-api /sms/send` | canonical SMS sender |
| `send-sms` | `messaging-api /sms/send-legacy` | older shape kept for compat |
| `messaging-send-sms` | `messaging-api /sms/send` | dup of telnyx-send-sms |
| `sms-send-reply` | `messaging-api /sms/reply` | thread replies |
| `sms-blast-processor` | `messaging-api /sms/blast/start` + `messaging-worker /blast/process` | UI + cron tick |
| `sms-conversation-ai` | `messaging-api /ai/sms-response` | one-shot AI reply |
| `communication-template-engine` | `messaging-api /sms/templates/render` | merge vars |
| `send-communication` | `messaging-api /communication/send` | multi-channel |
| `messaging-queue-processor` | `messaging-worker /queue/process` | cron queue |
| `ai-followup-worker` | `messaging-worker /followup/process` | SMS follow-up only |
| `telnyx-inbound-webhook` | `messaging-webhook /telnyx/inbound` | provider URL unchanged |
| `telnyx-sms-status-webhook` | `messaging-webhook /telnyx/status` | provider URL unchanged |
| `telnyx-call-webhook` | `messaging-webhook /telnyx/call-event` | shared SMS/call records |
| `messaging-inbound-webhook` | `messaging-webhook /generic/inbound` | Twilio/SendGrid fallback |

## Old functions shimmed

**None this loop.** Shimming a legacy function back to the grouped route while the grouped route delegates to the legacy function would create an infinite loop. The current pattern is the inverse:

```
frontend → messaging-api → (delegate) → legacy fn → DB writes
provider → legacy webhook fn (direct URL, sig-verified) → DB writes
```

Shims will be added once legacy logic is **ported inline** into the grouped function (Phase 1b).

## Old functions safe to delete after Phase 1b logic port

These will be safe to delete once their logic is inlined into messaging-api/worker/webhook:

- `messaging-send-sms` (already a duplicate of `telnyx-send-sms`)
- `send-sms` (legacy shape, replaced by `messaging-api /sms/send` for new callers)
- `communication-router` (834 lines — needs careful inline port)
- `communication-template-engine` (20-line stub — trivial port)

**Not safe to delete:** the four provider webhook functions (`telnyx-inbound-webhook`, `telnyx-sms-status-webhook`, `telnyx-call-webhook`, `messaging-inbound-webhook`) — their URLs are configured at the provider. They can be shimmed once Telnyx/Twilio dashboards point at `messaging-webhook` URLs.

## Frontend call sites updated

| File | Old | New |
|---|---|---|
| `src/hooks/useSendSMS.ts` | `telnyx-send-sms` | `messaging-api /sms/send` |
| `src/hooks/useCommunications.ts` | `sms-send-reply` | `messaging-api /sms/reply` |
| `src/components/contact-profile/ContactCommunicationTab.tsx` | `send-sms` | `messaging-api /sms/send` |
| `src/components/measurements/MeasurementShareDialog.tsx` | `send-sms` | `messaging-api /sms/send` |
| `src/components/settings/TelnyxIntegrationPanel.tsx` | `telnyx-send-sms` | `messaging-api /sms/send` |
| `src/components/communications/TextBlastCreator.tsx` (×3) | `sms-blast-processor` | `messaging-api /sms/blast/start` |
| `src/components/communications/TextBlastDetail.tsx` | `sms-blast-processor` | `messaging-api /sms/blast/start` |

**Total old-name messaging invocations replaced:** 9

## Remaining messaging old-name call sites (intentional defer)

- `src/components/settings/SmsAutoResponseConfig.tsx` (×3) — admin config panel with `action: 'get_config' | 'configure' | 'test'` shape. Needs a dedicated `messaging-api /sms/auto-responder/config` route, deferred to Phase 1b so the inline port can keep all three actions atomic.

## Audit / observability

Every grouped route writes to `edge_function_audit` via `router.ts` (status, latency, user_id, tenant_id, request_id, shim_from/x-delegated-from). Domain events additionally logged with `notes: {event, ...}`:

- `outbound_sms_sent`, `outbound_sms_reply`, `outbound_sms_thread`
- `inbound_sms_received`, `sms_status_callback`, `generic_inbound_received`
- `sms_blast_started`, `sms_blast_preview`, `blast_tick`
- `dnc_blocked`, `dnc_scrub`
- `ai_reply_generated`
- `webhook_signature_failure`

## Tests performed

- `deno run scripts/audit-edge-functions.ts` — clean run, +3 grouped functions promoted to "real routes wired"
- Static call-site count verified: 9 frontend invocations now hit `messaging-api`; only 3 messaging old-name invocations remain (all in `SmsAutoResponseConfig.tsx`)
- TypeScript build: no errors introduced
- Provider webhook URLs **not** changed — Telnyx continues hitting legacy URLs which retain signature verification

## Counts after this loop

| Metric | Before | After |
|---|---:|---:|
| Function folders (excl. `_shared`) | 456 | 456 |
| Grouped functions | 62 | 62 |
| Grouped with real routes | 14 | **17** |
| Scaffold-only grouped | 48 | **45** |
| Legacy shim functions | 0 | 0 |
| DELETE_CANDIDATE (zero refs) | 34 | 69 (audit reclassified) |
| Public webhooks (KEEP) | 26 | 26 |
| Frontend on old names | 277 | **273** |
| Messaging old-name frontend sites remaining | 12 | **3** |
| Messaging legacy fns migrated (now routed via grouped) | 0 | **14** |
| Messaging legacy fns shimmed | 0 | 0 |
| Messaging legacy fns safe to delete now | 0 | 0 |

## Phase 1b (next loop, messaging only)

1. Port `telnyx-send-sms` body into `messaging-api /sms/send` (eliminate delegation).
2. Port `sms-blast-processor` into worker route.
3. Add `messaging-api /sms/auto-responder/config` and migrate `SmsAutoResponseConfig.tsx`.
4. Once inline, shim `send-sms`, `messaging-send-sms`, `telnyx-send-sms`, `sms-send-reply`, `sms-conversation-ai`, `send-communication` → grouped.
5. Drop deletable folders. Net: -6 to -8 functions.
