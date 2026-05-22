# Edge Function Consolidation Audit

Generated: 2026-05-22T02:53:34.155Z
Total functions: **456**

## By status
- DELETE_CANDIDATE: 34
- KEEP: 26
- MIGRATE: 300
- SHIM: 96

## By risk
- HIGH: 53
- LOW: 313
- MEDIUM: 90

## By category (target consolidation domain)
- other: 154
- supplier: 35
- measurement: 30
- email: 23
- document: 21
- ai: 20
- telnyx: 18
- signature: 17
- webhook: 12
- qbo: 11
- canvass: 10
- payment: 9
- property-data: 8
- map: 7
- messaging: 7
- pdf: 7
- contact: 6
- roof-report-ingest: 6
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
- `docusign-webhook` → signature-webhook/docusign
- `external-lead-webhook` → webhook-api/lead-webhook
- `messaging-inbound-webhook` → messaging-webhook/generic/inbound
- `messaging-webhook` → webhook-api/webhook
- `proposal-webhook` → webhook-api/webhook
- `qbo-webhook` → qbo-webhook/events
- `qbo-webhook-handler` → qbo-webhook/events
- `resend-inbound-webhook` → webhook-api/inbound-webhook
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
- `abc-api`
- `admin-api`
- `ai-worker`
- `analytics-api`
- `auth-api`
- `backup-api`
- `canvass-api`
- `company-api`
- `contact-api`
- `document-api`
- `email-api`
- `email-worker`
- `health-api`
- `job-api`
- `map-api`
- `measurement-api`
- `measurement-worker`
- `messaging-worker`
- `pdf-api`
- `permit-api`
- `pipeline-api`
- `property-data-api`
- `qxo-api`
- `report-packet-api`
- `security-api`
- `signature-api`
- `srs-api`
- `storm-api`
- `stripe-worker`
- `supplier-worker`
- `task-api`
- `training-data-api`
- `user-api`
- `voice-api`

Full per-function breakdown: `docs/edge-function-consolidation-audit.csv`
