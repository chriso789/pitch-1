# Edge Function Consolidation Audit

Generated: 2026-05-22T14:13:02.684Z
Total functions: **457**

## By status
- DELETE_CANDIDATE: 63
- KEEP: 26
- MIGRATE: 291
- SHIM: 77

## By risk
- HIGH: 53
- LOW: 313
- MEDIUM: 91

## By category (target consolidation domain)
- other: 154
- supplier: 35
- measurement: 31
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
- `ai-context-builder`
- `ai-project-status-answer`
- `ai-sales-advisor`
- `ai-sales-coach`
- `apply-referral-credit-to-job`
- `approve-referral-payout`
- `automation-dispatcher`
- `backfill-email-statuses`
- `batch-update-contact-statuses`
- `canvass-auth`
- `canvass-document-sync`
- `canvass-estimate-sync`
- `canvass-pin-sync`
- `canvass-route-plan`
- `canvassiq-add-property`
- `canvassiq-auto-detect`
- `canvassiq-enrichment`
- `canvassiq-properties-geojson`
- `canvassiq-snap-to-buildings`
- `compare-ai-measurement-to-vendor`
- `create-referral-link`
- `crm-referral-approve-payout`
- `crm-referral-create-link`
- `crm-referral-evaluate-payout`
- `crm-referral-mark-paid`
- `crm-referral-register-signup`
- `crm-referral-resolve-flag`
- `crm-referral-track-click`
- `document-generator-engine`
- `document-template-manager`
- `email-sequence-engine`
- `email-sequence-manager`
- `financing-status-tracker`
- `generate-training-pair`
- `handle-email-suppression`
- `homeowner-magic-link-verify`
- `inventory-audit-processor`
- `inventory-manager`
- `mark-referral-payout-paid`
- `material-fulfillment-tracker`
- `material-order-processor`
- `notify-signature-opened`
- `pdf-compile`
- `pdf-extract-text`
- `pdf-parse`
- `pdf-render-page`
- `preview-transactional-email`
- `qxo-push-order`
- `qxo-submit-quote-order`
- `referral-track-event`
- `register-mobile-device`
- `report-packet-sign`
- `report-packet-view-event`
- `run-measurement-benchmark`
- `save-referral-payout-preference`
- `send-transactional-email`
- `storm-intel-score`
- `submit-referral-lead`
- `sunniland-importer`
- `telnyx-ai-agent-enhanced`
- `telnyx-dial`
- `validate-measurement`
- `validate-perimeter`

Full per-function breakdown: `docs/edge-function-consolidation-audit.csv`
