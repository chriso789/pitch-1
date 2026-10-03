# Edge Function Consolidation Audit

Generated: 2026-10-03T19:02:16.501Z
Total functions: **520**

## By status
- DELETE_CANDIDATE: 21
- KEEP: 28
- MIGRATE: 337
- SHIM: 134

## By risk
- HIGH: 57
- LOW: 351
- MEDIUM: 112

## By category (target consolidation domain)
- other: 186
- supplier: 39
- document: 35
- measurement: 33
- email: 26
- ai: 20
- telnyx: 18
- signature: 17
- qbo: 15
- webhook: 14
- canvass: 10
- payment: 9
- property-data: 8
- messaging: 8
- roof-report-ingest: 7
- map: 7
- pdf: 7
- contact: 6
- storm: 6
- report-packet: 6
- admin: 5
- permit: 5
- auth: 4
- pipeline: 4
- health: 4
- job: 3
- backup: 3
- company: 3
- training-data: 3
- user: 3
- stripe: 3
- analytics: 1
- security: 1
- task: 1

## Public webhooks (DO NOT DELETE without provider URL update)
- `abc-oauth-callback` → supplier-api/abc/oauth-callback
- `ai-inbound-router` → ai-api/inbound-router
- `amb-inbound` → webhook-api/inbound
- `asterisk-call-inbound` → webhook-api/call-inbound
- `asterisk-sms-inbound` → webhook-api/sms-inbound
- `centz-webhook` → webhook-api/webhook
- `docusign-webhook` → signature-webhook/docusign
- `external-lead-webhook` → webhook-api/lead-webhook
- `messaging-inbound-webhook` → messaging-webhook/generic/inbound
- `messaging-webhook` → webhook-api/webhook
- `proposal-webhook` → webhook-api/webhook
- `qbo-webhook` → qbo-webhook/events
- `qbo-webhook-handler` → qbo-webhook/events
- `resend-inbound-webhook` → webhook-api/inbound-webhook
- `resend-invoice-webhook` → webhook-api/invoice-webhook
- `resend-webhook` → webhook-api/webhook
- `roofhub-webhook` → webhook-api/webhook
- `signature-webhook` → signature-api/webhook
- `stripe-webhook` → stripe-webhook/events
- `stripe-webhook-handler` → stripe-webhook/events
- `supplier-webhook` → supplier-api/webhook
- `telnyx-call-webhook` → telnyx-webhook/call-webhook
- `telnyx-inbound-webhook` → telnyx-webhook/inbound-webhook
- `telnyx-sms-status-webhook` → telnyx-webhook/sms-status-webhook
- `telnyx-webhook` → telnyx-webhook/webhook
- `voice-inbound` → webhook-api/inbound
- `webhook-api` → webhook-api/api
- `webhook-manager` → webhook-api/manager

## Delete candidates (zero references)
- `aggregate-blueprint-vision-v2`
- `backfill-property-addresses`
- `convert-stored-heic`
- `google-calendar-demo-sync`
- `invoice-share`
- `invoice-track`
- `labor-order-send-email`
- `log-login-attempt`
- `material-order-send-email`
- `notify-labor-order-scheduled`
- `pitch-key-whoami`
- `qbo-payment-poller`
- `report-packet-send-resend`
- `resend-user-invitation`
- `retry-stale-ocr-documents`
- `send-password-reset`
- `send-quote-email`
- `sms-blast-followup-enqueue`
- `sync-user-email`
- `synthesize-blueprint-trade-takeoffs`
- `verify-email-domain`

Full per-function breakdown: `docs/edge-function-consolidation-audit.csv`
