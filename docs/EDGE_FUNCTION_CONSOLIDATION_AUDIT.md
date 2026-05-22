# Edge Function Consolidation Audit

Generated: 2026-05-22T01:16:09.614Z
Total functions: **410**

## By status
- DELETE_CANDIDATE: 69
- KEEP: 20
- MIGRATE: 300
- SHIM: 21

## By risk
- HIGH: 43
- LOW: 285
- MEDIUM: 82

## By category (target consolidation domain)
- other: 147
- supplier: 29
- measurement: 28
- email: 21
- document: 20
- ai: 18
- telnyx: 16
- signature: 15
- webhook: 10
- qbo: 10
- canvass: 9
- property-data: 8
- payment: 8
- messaging: 7
- roof-report-ingest: 6
- map: 6
- pdf: 6
- contact: 5
- storm: 5
- report-packet: 5
- admin: 4
- permit: 4
- company: 3
- pipeline: 3
- health: 3
- user: 3
- auth: 3
- job: 2
- backup: 2
- training-data: 2
- stripe: 2

## Public webhooks (DO NOT DELETE without provider URL update)
- `abc-oauth-callback` → supplier-api/abc/oauth-callback
- `ai-inbound-router` → ai-api/inbound-router
- `amb-inbound` → webhook-api/inbound
- `asterisk-call-inbound` → webhook-api/call-inbound
- `asterisk-sms-inbound` → webhook-api/sms-inbound
- `docusign-webhook` → signature-webhook/docusign
- `external-lead-webhook` → webhook-api/lead-webhook
- `messaging-inbound-webhook` → messaging-webhook/generic/inbound
- `proposal-webhook` → webhook-api/webhook
- `qbo-webhook` → qbo-webhook/events
- `qbo-webhook-handler` → qbo-webhook/events
- `resend-inbound-webhook` → webhook-api/inbound-webhook
- `resend-webhook` → webhook-api/webhook
- `roofhub-webhook` → webhook-api/webhook
- `stripe-webhook-handler` → stripe-webhook/events
- `telnyx-call-webhook` → telnyx-webhook/call-webhook
- `telnyx-inbound-webhook` → telnyx-webhook/inbound-webhook
- `telnyx-sms-status-webhook` → telnyx-webhook/sms-status-webhook
- `voice-inbound` → webhook-api/inbound
- `webhook-manager` → webhook-api/manager

## Delete candidates (zero references)
- `ai-context-builder`
- `ai-project-status-answer`
- `ai-sales-advisor`
- `ai-sales-coach`
- `apply-referral-credit-to-job`
- `approve-referral-payout`
- `auto-generate-measurements`
- `automation-dispatcher`
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
- `communication-router`
- `communication-template-engine`
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
- `measure-roof`
- `notify-signature-opened`
- `pdf-compile`
- `pdf-extract-text`
- `pdf-parse`
- `pdf-render-page`
- `preview-transactional-email`
- `qbo-check-projects-api`
- `qxo-push-order`
- `qxo-submit-quote-order`
- `referral-track-event`
- `register-mobile-device`
- `report-packet-sign`
- `report-packet-view-event`
- `run-measurement-benchmark`
- `save-referral-payout-preference`
- `send-communication`
- `send-transactional-email`
- `sms-conversation-ai`
- `storm-intel-score`
- `submit-referral-lead`
- `sunniland-importer`
- `telnyx-ai-agent-enhanced`
- `telnyx-dial`
- `validate-measurement`
- `validate-perimeter`

Full per-function breakdown: `docs/edge-function-consolidation-audit.csv`
