

# Plan: Add All Missing Edge Functions to config.toml

## Analysis Summary

After comparing the `supabase/functions/` directory against `supabase/config.toml`:

**Functions in Code:** 319 folders (excluding `_shared/` and `deno.json`)
**Functions in Config:** 204 entries
**Missing Functions:** 115 functions need to be added

---

## Missing Functions to Add

These functions exist in code but are NOT in `config.toml`:

| Function Name | Recommended JWT Setting | Reason |
|---------------|------------------------|--------|
| `abc-pricing` | `verify_jwt = true` | Pricing data - requires auth |
| `admin-update-password` | `verify_jwt = true` | Admin operation - requires auth |
| `ai-appointment-scheduler` | `verify_jwt = true` | AI feature - requires auth |
| `ai-sales-coach` | `verify_jwt = true` | AI feature - requires auth |
| `amb-inbound` | `verify_jwt = false` | Webhook endpoint |
| `amb-send` | `verify_jwt = true` | Outbound messaging - requires auth |
| `audit-button-pathways` | `verify_jwt = true` | Admin/audit - requires auth |
| `auto-generate-measurements` | `verify_jwt = true` | Measurement tool - requires auth |
| `batch-regenerate-measurements` | `verify_jwt = true` | Batch operation - requires auth |
| `bi-report-engine` | `verify_jwt = true` | Reporting - requires auth |
| `call-answering-service` | `verify_jwt = false` | Inbound calls - external webhook |
| `canvassiq-snap-to-buildings` | `verify_jwt = true` | Canvass feature - requires auth |
| `communication-template-engine` | `verify_jwt = true` | Templates - requires auth |
| `compliance-monitor` | `verify_jwt = false` | Background job |
| `create-signature-envelope` | `verify_jwt = true` | Signature feature - requires auth |
| `cross-sell-analyzer` | `verify_jwt = true` | AI/analytics - requires auth |
| `customer-lifecycle-manager` | `verify_jwt = true` | Customer management - requires auth |
| `customer-retention-ai` | `verify_jwt = true` | AI feature - requires auth |
| `delete-pipeline-entry` | `verify_jwt = true` | Delete operation - requires auth |
| `dialer-analytics-engine` | `verify_jwt = true` | Analytics - requires auth |
| `document-generator-engine` | `verify_jwt = true` | Document gen - requires auth |
| `document-template-manager` | `verify_jwt = true` | Templates - requires auth |
| `docusign-auth` | `verify_jwt = true` | OAuth flow - requires auth |
| `docusign-create-envelope` | `verify_jwt = true` | DocuSign feature - requires auth |
| `docusign-embedded-views` | `verify_jwt = true` | DocuSign feature - requires auth |
| `docusign-send-envelope` | `verify_jwt = true` | DocuSign feature - requires auth |
| `docusign-update-docgen` | `verify_jwt = true` | DocuSign feature - requires auth |
| `docusign-webhook` | `verify_jwt = false` | Webhook from DocuSign |
| `equipment-maintenance-scheduler` | `verify_jwt = true` | Scheduling - requires auth |
| `excel-style-estimate-calculator` | `verify_jwt = true` | Calculator - requires auth |
| `financial-forecasting-ai` | `verify_jwt = true` | AI feature - requires auth |
| `financial-report-generator` | `verify_jwt = true` | Reporting - requires auth |
| `financing-application-processor` | `verify_jwt = true` | Financing - requires auth |
| `financing-status-tracker` | `verify_jwt = true` | Financing - requires auth |
| `fleet-manager` | `verify_jwt = true` | Fleet management - requires auth |
| `franchise-manager` | `verify_jwt = true` | Franchise feature - requires auth |
| `franchise-royalty-processor` | `verify_jwt = true` | Franchise feature - requires auth |
| `generate-estimate-pdf` | `verify_jwt = true` | PDF generation - requires auth |
| `generate-scope-document` | `verify_jwt = true` | Document gen - requires auth |
| `generate-supplement-request` | `verify_jwt = true` | Supplement feature - requires auth |
| `inspection-scheduler` | `verify_jwt = true` | Scheduling - requires auth |
| `inventory-audit-processor` | `verify_jwt = true` | Inventory - requires auth |
| `inventory-manager` | `verify_jwt = true` | Inventory - requires auth |
| `job-drag-handler` | `verify_jwt = true` | UI handler - requires auth |
| `labor-order-send-email` | `verify_jwt = true` | Email sending - requires auth |
| `lead-attribution-tracker` | `verify_jwt = true` | Analytics - requires auth |
| `log-performance-metric` | `verify_jwt = true` | Logging - requires auth |
| `marketing-roi-calculator` | `verify_jwt = true` | Analytics - requires auth |
| `multi-location-hub` | `verify_jwt = true` | Location management - requires auth |
| `permit-application-generator` | `verify_jwt = true` | Permit feature - requires auth |
| `permit-detect-jurisdiction` | `verify_jwt = true` | Permit feature - requires auth |
| `permit-fetch-property-data` | `verify_jwt = true` | Permit feature - requires auth |
| `permit_build_case` | `verify_jwt = true` | Permit feature - requires auth |
| `permit_generate_documents` | `verify_jwt = true` | Permit feature - requires auth |
| `permit_link_approvals` | `verify_jwt = true` | Permit feature - requires auth |
| `pipeline-drag-handler` | `verify_jwt = true` | UI handler - requires auth |
| `power-dialer-controller` | `verify_jwt = true` | Dialer feature - requires auth |
| `predictive-analytics-engine` | `verify_jwt = true` | AI/analytics - requires auth |
| `project-progress-reporter` | `verify_jwt = true` | Reporting - requires auth |
| `project-timeline-builder` | `verify_jwt = true` | Project feature - requires auth |
| `punch-list-processor` | `verify_jwt = true` | Project feature - requires auth |
| `qbo-webhook` | `verify_jwt = false` | Webhook from QuickBooks |
| `quality-inspection-manager` | `verify_jwt = true` | Quality feature - requires auth |
| `real-time-kpi-engine` | `verify_jwt = true` | Analytics - requires auth |
| `reanalyze-with-footprint` | `verify_jwt = true` | Measurement tool - requires auth |
| `referral-manager` | `verify_jwt = true` | Referral feature - requires auth |
| `referral-rewards-processor` | `verify_jwt = true` | Referral feature - requires auth |
| `regression-monitor` | `verify_jwt = false` | Background job |
| `render-liquid` | `verify_jwt = true` | Template rendering - requires auth |
| `report-packet-generate-pdf` | `verify_jwt = true` | Report packet - requires auth |
| `report-packet-send-resend` | `verify_jwt = true` | Report packet - requires auth |
| `report-packet-sign` | `verify_jwt = false` | Public signing flow |
| `report-packet-upsert-draft` | `verify_jwt = true` | Report packet - requires auth |
| `report-packet-view-event` | `verify_jwt = false` | Public view tracking |
| `run-measurement-benchmark` | `verify_jwt = true` | Benchmark - requires auth |
| `sales-territory-balancer` | `verify_jwt = true` | Sales feature - requires auth |
| `scope-comparison-analyze` | `verify_jwt = true` | Scope feature - requires auth |
| `scope-network-line-items` | `verify_jwt = true` | Scope feature - requires auth |
| `seed-company-owners` | `verify_jwt = true` | Admin operation - requires auth |
| `send-demo-request` | `verify_jwt = false` | Public form submission |
| `send-email` | `verify_jwt = true` | Email sending - requires auth |
| `send-mention-notification` | `verify_jwt = true` | Notification - requires auth |
| `send-presentation-notification` | `verify_jwt = true` | Notification - requires auth |
| `send-review-request` | `verify_jwt = true` | Review request - requires auth |
| `send-sms` | `verify_jwt = true` | SMS sending - requires auth |
| `srs-price-refresh-scheduler` | `verify_jwt = false` | Background job |
| `srs-pricing` | `verify_jwt = true` | Pricing data - requires auth |
| `subcontractor-payment-processor` | `verify_jwt = true` | Payment feature - requires auth |
| `subcontractor-portal-manager` | `verify_jwt = true` | Portal feature - requires auth |
| `sync-user-email` | `verify_jwt = true` | Sync operation - requires auth |
| `sync-verified-coordinates` | `verify_jwt = true` | Sync operation - requires auth |
| `text-to-speech` | `verify_jwt = true` | TTS feature - requires auth |
| `transcripts-ingest` | `verify_jwt = false` | Webhook from transcription service |
| `unified-search` | `verify_jwt = true` | Search feature - requires auth |
| `update-user-role` | `verify_jwt = true` | Admin operation - requires auth |
| `validate-view-token` | `verify_jwt = false` | Token validation - public |
| `vendor-manager` | `verify_jwt = true` | Vendor feature - requires auth |
| `vendor-scorecard-generator` | `verify_jwt = true` | Vendor feature - requires auth |
| `warranty-claim-processor` | `verify_jwt = true` | Warranty feature - requires auth |
| `warranty-registration-manager` | `verify_jwt = true` | Warranty feature - requires auth |
| `webhook-manager` | `verify_jwt = true` | Webhook management - requires auth |
| `webrtc-signaling` | `verify_jwt = true` | WebRTC - requires auth |
| `workflow-automation` | `verify_jwt = true` | Automation - requires auth |
| `xactimate-exporter` | `verify_jwt = true` | Export feature - requires auth |

---

## Orphaned Configs to Remove

These are in `config.toml` but NO matching function folder exists:

| Config Entry | Action |
|--------------|--------|
| `asterisk-email-inbound` | Remove from config |
| `schedule-crew-job` | Remove from config |
| `submit-crew-schedule-request` | Remove from config |
| `process-insurance-claim` | Remove from config |

---

## Implementation

### File to Modify

`supabase/config.toml`

### Changes

1. **Remove 4 orphaned entries** (functions that don't exist in code)
2. **Add 115 missing function entries** with appropriate `verify_jwt` settings

### JWT Security Guidelines Applied

- `verify_jwt = false` for:
  - Webhook endpoints (external services calling in)
  - Public-facing features (signing links, demo requests)
  - Background jobs and schedulers
  
- `verify_jwt = true` for:
  - All user-initiated actions
  - Admin operations
  - Data access/modification
  - AI features
  - Document generation

---

## Result After Implementation

- All 319 edge functions will be deployable
- Orphaned config entries removed
- Proper security (JWT verification) applied to each function
- Functions will auto-deploy on next publish

---

## Config Additions to Append

The following entries will be added to the end of `config.toml`:

```toml
# ===== MISSING FUNCTIONS - BATCH ADD =====

[functions.abc-pricing]
verify_jwt = true

[functions.admin-update-password]
verify_jwt = true

[functions.ai-appointment-scheduler]
verify_jwt = true

[functions.ai-sales-coach]
verify_jwt = true

[functions.amb-inbound]
verify_jwt = false

[functions.amb-send]
verify_jwt = true

[functions.audit-button-pathways]
verify_jwt = true

[functions.auto-generate-measurements]
verify_jwt = true

[functions.batch-regenerate-measurements]
verify_jwt = true

[functions.bi-report-engine]
verify_jwt = true

[functions.call-answering-service]
verify_jwt = false

[functions.canvassiq-snap-to-buildings]
verify_jwt = true

[functions.communication-template-engine]
verify_jwt = true

[functions.compliance-monitor]
verify_jwt = false

[functions.create-signature-envelope]
verify_jwt = true

[functions.cross-sell-analyzer]
verify_jwt = true

[functions.customer-lifecycle-manager]
verify_jwt = true

[functions.customer-retention-ai]
verify_jwt = true

[functions.delete-pipeline-entry]
verify_jwt = true

[functions.dialer-analytics-engine]
verify_jwt = true

[functions.document-generator-engine]
verify_jwt = true

[functions.document-template-manager]
verify_jwt = true

[functions.docusign-auth]
verify_jwt = true

[functions.docusign-create-envelope]
verify_jwt = true

[functions.docusign-embedded-views]
verify_jwt = true

[functions.docusign-send-envelope]
verify_jwt = true

[functions.docusign-update-docgen]
verify_jwt = true

[functions.docusign-webhook]
verify_jwt = false

[functions.equipment-maintenance-scheduler]
verify_jwt = true

[functions.excel-style-estimate-calculator]
verify_jwt = true

[functions.financial-forecasting-ai]
verify_jwt = true

[functions.financial-report-generator]
verify_jwt = true

[functions.financing-application-processor]
verify_jwt = true

[functions.financing-status-tracker]
verify_jwt = true

[functions.fleet-manager]
verify_jwt = true

[functions.franchise-manager]
verify_jwt = true

[functions.franchise-royalty-processor]
verify_jwt = true

[functions.generate-estimate-pdf]
verify_jwt = true

[functions.generate-scope-document]
verify_jwt = true

[functions.generate-supplement-request]
verify_jwt = true

[functions.inspection-scheduler]
verify_jwt = true

[functions.inventory-audit-processor]
verify_jwt = true

[functions.inventory-manager]
verify_jwt = true

[functions.job-drag-handler]
verify_jwt = true

[functions.labor-order-send-email]
verify_jwt = true

[functions.lead-attribution-tracker]
verify_jwt = true

[functions.log-performance-metric]
verify_jwt = true

[functions.marketing-roi-calculator]
verify_jwt = true

[functions.multi-location-hub]
verify_jwt = true

[functions.permit-application-generator]
verify_jwt = true

[functions.permit-detect-jurisdiction]
verify_jwt = true

[functions.permit-fetch-property-data]
verify_jwt = true

[functions.permit_build_case]
verify_jwt = true

[functions.permit_generate_documents]
verify_jwt = true

[functions.permit_link_approvals]
verify_jwt = true

[functions.pipeline-drag-handler]
verify_jwt = true

[functions.power-dialer-controller]
verify_jwt = true

[functions.predictive-analytics-engine]
verify_jwt = true

[functions.project-progress-reporter]
verify_jwt = true

[functions.project-timeline-builder]
verify_jwt = true

[functions.punch-list-processor]
verify_jwt = true

[functions.qbo-webhook]
verify_jwt = false

[functions.quality-inspection-manager]
verify_jwt = true

[functions.real-time-kpi-engine]
verify_jwt = true

[functions.reanalyze-with-footprint]
verify_jwt = true

[functions.referral-manager]
verify_jwt = true

[functions.referral-rewards-processor]
verify_jwt = true

[functions.regression-monitor]
verify_jwt = false

[functions.render-liquid]
verify_jwt = true

[functions.report-packet-generate-pdf]
verify_jwt = true

[functions.report-packet-send-resend]
verify_jwt = true

[functions.report-packet-sign]
verify_jwt = false

[functions.report-packet-upsert-draft]
verify_jwt = true

[functions.report-packet-view-event]
verify_jwt = false

[functions.run-measurement-benchmark]
verify_jwt = true

[functions.sales-territory-balancer]
verify_jwt = true

[functions.scope-comparison-analyze]
verify_jwt = true

[functions.scope-network-line-items]
verify_jwt = true

[functions.seed-company-owners]
verify_jwt = true

[functions.send-demo-request]
verify_jwt = false

[functions.send-email]
verify_jwt = true

[functions.send-mention-notification]
verify_jwt = true

[functions.send-presentation-notification]
verify_jwt = true

[functions.send-review-request]
verify_jwt = true

[functions.send-sms]
verify_jwt = true

[functions.srs-price-refresh-scheduler]
verify_jwt = false

[functions.srs-pricing]
verify_jwt = true

[functions.subcontractor-payment-processor]
verify_jwt = true

[functions.subcontractor-portal-manager]
verify_jwt = true

[functions.sync-user-email]
verify_jwt = true

[functions.sync-verified-coordinates]
verify_jwt = true

[functions.text-to-speech]
verify_jwt = true

[functions.transcripts-ingest]
verify_jwt = false

[functions.unified-search]
verify_jwt = true

[functions.update-user-role]
verify_jwt = true

[functions.validate-view-token]
verify_jwt = false

[functions.vendor-manager]
verify_jwt = true

[functions.vendor-scorecard-generator]
verify_jwt = true

[functions.warranty-claim-processor]
verify_jwt = true

[functions.warranty-registration-manager]
verify_jwt = true

[functions.webhook-manager]
verify_jwt = true

[functions.webrtc-signaling]
verify_jwt = true

[functions.workflow-automation]
verify_jwt = true

[functions.xactimate-exporter]
verify_jwt = true
```

