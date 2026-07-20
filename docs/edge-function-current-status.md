# Edge Function Consolidation — Current Status

Generated: 2026-05-22T14:13:02.699Z

## Live counts

| Metric | Count |
|---|---:|
| Function folders (excluding `_shared`) | **457** |
| Grouped routed functions (`*-api` / `*-worker` / `*-webhook`) | **62** |
| ↳ with real routes wired | **19** |
| ↳ scaffold-only (501 not_migrated) | **43** |
| Legacy shim functions (index.ts forwards via `_shared/shim.ts`) | **17** |
| MIGRATE rows in audit CSV | **291** |
| ↳ still classified `TBD` (need manual target) | **109** |
| DELETE_CANDIDATE rows (zero references) | **63** |
| Public webhook functions that MUST stay (KEEP) | **26** |
| Frontend call sites still pointing to OLD function names | **261** |

## Scaffold-only grouped functions (need logic ported in)

- `abc-api`
- `admin-api`
- `ai-api`
- `ai-worker`
- `analytics-api`
- `auth-api`
- `backup-api`
- `canvass-api`
- `company-api`
- `contact-api`
- `document-api`
- `health-api`
- `job-api`
- `map-api`
- `measurement-api`
- `measurement-worker`
- `payment-api`
- `pdf-api`
- `permit-api`
- `pipeline-api`
- `property-data-api`
- `qbo-api`
- `qbo-webhook`
- `qbo-worker`
- `qxo-api`
- `report-packet-api`
- `security-api`
- `signature-api`
- `signature-webhook`
- `srs-api`
- `storm-api`
- `stripe-webhook`
- `stripe-worker`
- `supplier-api`
- `supplier-webhook`
- `supplier-worker`
- `task-api`
- `telnyx-api`
- `telnyx-webhook`
- `training-data-api`
- `user-api`
- `voice-api`
- `webhook-api`

## Grouped functions with real routes

- `ai-followup-worker`
- `automation-worker`
- `docusign-webhook`
- `email-api`
- `email-worker`
- `external-lead-webhook`
- `material-pricing-api`
- `messaging-api`
- `messaging-inbound-webhook`
- `messaging-webhook`
- `messaging-worker`
- `proposal-webhook`
- `qbo-check-projects-api`
- `resend-inbound-webhook`
- `resend-webhook`
- `roofhub-webhook`
- `telnyx-call-webhook`
- `telnyx-inbound-webhook`
- `telnyx-sms-status-webhook`

## Legacy shim functions (forwarding to grouped APIs)

- `abc-api-proxy`
- `admin-cleanup-sms-templates`
- `admin-create-user`
- `admin-delete-user`
- `admin-update-password`
- `ai-admin-agent`
- `ai-command-processor`
- `ai-error-fixer`
- `ai-image-analyzer`
- `billtrust-auth`
- `billtrust-pricing`
- `canvass-area-auto-split`
- `canvass-area-build-heatmap`
- `canvass-area-build-membership`
- `canvass-dispositions`
- `canvass-drop-pin`
- `canvassiq-skip-trace`

## Public webhooks (do NOT delete — provider dashboard URLs depend on these)

- `abc-oauth-callback`
- `ai-inbound-router`
- `amb-inbound`
- `asterisk-call-inbound`
- `asterisk-sms-inbound`
- `docusign-webhook`
- `external-lead-webhook`
- `messaging-inbound-webhook`
- `messaging-webhook`
- `proposal-webhook`
- `qbo-webhook`
- `qbo-webhook-handler`
- `resend-inbound-webhook`
- `resend-webhook`
- `roofhub-webhook`
- `signature-webhook`
- `stripe-webhook`
- `stripe-webhook-handler`
- `supplier-webhook`
- `telnyx-call-webhook`
- `telnyx-inbound-webhook`
- `telnyx-sms-status-webhook`
- `telnyx-webhook`
- `voice-inbound`
- `webhook-api`
- `webhook-manager`

## Frontend call sites still pointing to old function names

- `abc-api-proxy` — src/components/orders/PushToSupplierDialog.tsx, src/components/settings/ABCConnectionSettings.tsx
- `admin-cleanup-sms-templates` — src/components/communications/TextBlastCreator.tsx
- `admin-create-user` — src/components/settings/EnhancedCompanyOnboarding.tsx, src/components/settings/UserManagement.tsx, src/pages/onboarding/OnboardingWalkthrough.tsx
- `admin-delete-user` — src/components/settings/UserManagement.tsx
- `admin-update-password` — src/components/settings/EnhancedUserProfile.tsx
- `ai-admin-agent` — src/components/ai-admin/AIAdminChat.tsx
- `ai-appointment-scheduler` — src/components/scheduling/AIAppointmentScheduler.tsx
- `ai-claude-processor` — src/components/settings/ClaudeAITester.tsx, src/pages/IntegrationDashboard.tsx
- `ai-command-processor` — src/shared/components/AIAssistant.tsx
- `ai-error-fixer` — src/hooks/useAIErrorFixer.ts
- `ai-followup-runner` — src/components/communications/AIFollowupAgentSettings.tsx
- `ai-image-analyzer` — src/shared/components/forms/PhotoCaptureGuide.tsx
- `ai-lead-scorer` — src/components/AILeadScorer.tsx, src/features/leads/components/LeadScoreDashboard.tsx
- `ai-measurement-analyzer` — src/components/measurements/AIRoofAnalyzer.tsx
- `analyze-image-quality` — src/components/measurements/MeasurementTestPanel.tsx
- `analyze-roof-aerial` — src/components/measurements/MeasurementTestPanel.tsx, src/components/measurements/RoofrStyleReportPreview.tsx
- `api-approve-job-from-lead` — src/components/ApprovalRequirementsBubbles.tsx, src/components/JobApprovalDialog.tsx, src/components/ManagerApprovalQueue.tsx (+2 more)
- `approve-cost-reconciliation` — src/components/production/CostReconciliationPanel.tsx
- `approve-order` — src/pages/PendingApprovals.tsx
- `assign-contact-task` — src/components/contact-profile/ContactNotesSection.tsx
- `audit-button-pathways` — src/components/automation/AutomationDashboard.tsx
- `audit-cost-invoice` — src/pages/MaterialAuditPage.tsx
- `automation-processor` — src/lib/automations/triggerAutomation.ts
- `backfill-ai-usage` — src/components/settings/AIUsageDashboard.tsx
- `backfill-verification-addresses` — src/components/settings/VendorVerificationDashboard.tsx
- `batch-regenerate-measurements` — src/components/measurements/BatchRegenerationPanel.tsx
- `batch-remeasure` — src/components/measurements/BatchRemeasurementPanel.tsx
- `billtrust-auth` — src/features/settings/components/SupplierManagement.tsx
- `billtrust-pricing` — src/features/settings/components/SupplierManagement.tsx
- `build-derived-pricelists` — src/pages/MaterialAuditPage.tsx
- `calculate-measurement-corrections` — src/components/settings/TrainingAnalyticsDashboard.tsx, src/components/settings/TrainingComparisonView.tsx, src/pages/ReportImportDashboard.tsx
- `calculate-roof-measurements` — src/components/roof-measurement/MeasurementWorkflow.tsx
- `calendar-ical-feed` — src/components/settings/CalendarSyncSettings.tsx
- `call-answering-service` — src/components/AnsweringServiceConfig.tsx
- `call-forwarding` — src/components/CallForwardingConfig.tsx
- `canvass-area-auto-split` — src/components/storm-canvass/AutoSplitButton.tsx
- `canvass-area-build-heatmap` — src/components/storm-canvass/TerritoryManagerMap.tsx
- `canvass-area-build-membership` — src/components/storm-canvass/TerritoryManagerMap.tsx
- `canvass-dispositions` — src/services/offlineManager.ts, src/services/unifiedOfflineStore.ts
- `canvass-drop-pin` — src/components/storm-canvass/DropPinDialog.tsx
- `canvassiq-load-parcels` — src/components/storm-canvass/GooglePropertyMarkersLayer.tsx, src/components/storm-canvass/PropertyMarkersLayer.tsx
- `canvassiq-skip-trace` — src/components/storm-canvass/PropertyInfoPanel.tsx
- `capture-digital-signature` — src/pages/SignDocument.tsx
- `classify-blueprint-pages` — src/integrations/blueprintApi.ts
- `communication-inbox-manager` — src/components/inbox/StaffAssignmentDropdown.tsx
- `compare-accuracy` — src/components/settings/CoverageGapPanel.tsx
- `compare-scope-documents` — src/hooks/useScopeIntelligence.ts
- `create-company-user` — src/components/settings/CreateCompanyFromDemoDialog.tsx
- `create-lead-with-contact` — src/components/EnhancedLeadCreationDialog.tsx
- `create-material-order` — src/components/materials/MaterialCalculator.tsx

_…and 211 more — see CSV._

## Remaining action plan to get below 150 deployed Supabase functions

Current: **457**. Target: **<150**. Gap: **307**.

1. **Phase A — Wire routes** (43 grouped functions still stubs). Port logic from the 182 MIGRATE rows with concrete targets into the matching grouped function. _No change to function count yet._
2. **Phase B — Resolve TBD** (109 rows). Classify each into an existing domain or escalate to DELETE_CANDIDATE.
3. **Phase C — Shim legacy** (replace 291 legacy `index.ts` files with `forward(...)` calls to their grouped target). _No change to function count yet — shims still occupy folders._
4. **Phase D — Frontend migration**: convert the 261 old call sites to call the grouped function + route directly. Once 100% migrated, the shims have zero production traffic.
5. **Phase E — First delete sweep**: delete the 63 DELETE_CANDIDATE folders (zero refs anywhere). Drops count to **~394**.
6. **Phase F — Drop shims**: after edge-function logs show zero shim traffic for 7 days, delete the legacy folders. Drops count by ~17.
7. **Phase G — Audit KEEP webhooks**: confirm with provider dashboards which can be consolidated under `*-webhook` grouped functions. Worst case all 26 stay.

**Projected end state:** `62` grouped functions + `26` standalone webhooks ≈ **88** deployed functions — well below 150.

---

Full per-function breakdown: `docs/edge-function-consolidation-audit.csv`.
Policy: `docs/EDGE_FUNCTION_RULES.md` — **one domain = one edge function with internal routes**.

## 2026-07-20 — QBO Sub-plan E/F migration

Legacy QBO endpoints are now **authenticated shims** that reject body `tenant_id` / `realm_id` and forward to `qbo-worker`:

| Legacy function | Now forwards to | Status |
|---|---|---|
| `qbo-customer-sync` | `qbo-worker { op: syncProject }` | SHIM (verify_jwt=true) |
| `qbo-invoice-create` | `qbo-worker { op: createInvoiceFromEstimates }` | SHIM (verify_jwt=true) |
| `qbo-sync-payment` | `qbo-worker { op: syncPaymentStatus \| refreshAr }` | SHIM (verify_jwt=true) |
| `qbo-invoice-send` | `qbo-worker { op: toggleOnlinePayments }` | SHIM (verify_jwt=true) |

Shared helper: `supabase/functions/_shared/qbo-shim.ts`. Every response carries `X-Deprecation` and `X-Rejected-Body-Fields`.

Frontend caller migrated: `src/components/jobs/QuickBooksInvoiceCard.tsx` now invokes `qbo-worker` directly.

Schema hardening (see migration): every QBO mapping/mirror/settings table now carries `qbo_connection_id`, and uniqueness is scoped by `(tenant_id, qbo_connection_id, realm_id, ...)`. `invoice_ar_mirror` is now unique per QBO invoice (not per project). Partial unique index enforces one active QBO connection per tenant.
