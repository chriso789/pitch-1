
# Phases 8-56 Implementation Plan (Next 50 Phases)

Batch 1 (Phases 7, 9, 10, 18) is complete. This plan covers the remaining 49 phases from the original 7-25 scope plus phases 26-56, totaling ~50 phases of work.

---

## Status Legend

- **DONE** = Fully implemented (backend + frontend wired)
- **BACKEND ONLY** = Edge function/DB exists, needs frontend UI
- **PARTIAL** = Some components exist, needs completion
- **NEW** = Must be built from scratch

---

## Batch 2: Communications + SMS + Invoicing (Phases 8, 11, 12, 13)

### Phase 8: Unified Communications Timeline -- BACKEND ONLY
Both `UnifiedTimeline.tsx` and `UnifiedCommunicationsTimeline.tsx` components exist with SMS/call/email loading. Need to ensure they are wired into the Lead Detail page tabs and add channel filter controls (SMS | Email | Call | All).

**Work:**
- Verify `UnifiedCommunicationsTimeline` is rendered in lead/project detail tabs
- Add channel filter dropdown and date range selector
- Estimated: 1 component edit

### Phase 11: Automated Email Sequences -- BACKEND ONLY
`email-sequence-engine` and `email-sequence-manager` edge functions exist with real logic. DB tables (`email_sequences`, `email_sequence_steps`, `email_sequence_enrollments`) exist. No UI exists.

**Work:**
- Create `EmailSequenceBuilder.tsx` -- visual step editor with delay/email config
- Create `EmailSequenceList.tsx` -- list of sequences with enrollment counts
- Add "Enroll in Sequence" action to lead context menus
- Add settings tab or dedicated page
- Estimated: 3 new components

### Phase 12: SMS Auto-Response Agent -- BACKEND ONLY
`sms-auto-responder` edge function (269 lines, real keyword trigger logic) exists. No config UI.

**Work:**
- Create `SmsAutoResponseConfig.tsx` settings panel
- Configure keyword triggers, business hours, enable/disable per location
- Wire into Settings > Integrations tab
- Estimated: 1 new component, 1 settings integration

### Phase 13: Invoice Generation from Estimates -- PARTIAL
`JobInvoiceTracker` exists but uses MOCK data. `qbo-invoice-create` edge function exists for QuickBooks. `project_cost_invoices` table exists.

**Work:**
- Create DB migration for `invoices` and `invoice_line_items` tables
- Build "Convert to Invoice" button on approved estimates
- Wire `JobInvoiceTracker` to real database queries instead of mock data
- Add invoice PDF generation using existing `generate-estimate-pdf` patterns
- Estimated: 2 new components, 1 migration, 1 component rewrite

---

## Batch 3: Customer Experience (Phases 14, 15, 16)

### Phase 14: Financing Options Display -- PARTIAL
`FinancingCalculator.tsx` component exists with GreenSky/Synchrony/Mosaic options. `useFinancingCalculations` hook exists. `financing-application-processor` is a STUB.

**Work:**
- Implement real logic in `financing-application-processor` edge function
- Ensure `FinancingCalculator` is rendered on proposal/estimate preview pages
- Add financing selection to customer portal view
- Estimated: 1 edge function rewrite, 1 component wiring

### Phase 15: Customer Satisfaction Surveys -- BACKEND ONLY
`request-customer-review` edge function (257 lines, real logic) exists. `ReviewRequestManager` component exists. DB tables for surveys/reviews exist.

**Work:**
- Create public survey form page (accessible via email link)
- Add NPS score widget to dashboard
- Wire auto-trigger on project completion via automation system
- Estimated: 2 new components, 1 automation config

### Phase 16: Referral Tracking System -- BACKEND ONLY
`referral-manager` edge function exists. `ReferralRewardsSection` in customer portal exists. DB tables for referrals/rewards exist.

**Work:**
- Create admin `ReferralDashboard.tsx` showing referral pipeline, conversion rates
- Add referral code generator in settings
- Ensure portal `ReferralRewardsSection` calls the edge function correctly
- Estimated: 1 new dashboard component, 1 settings component

---

## Batch 4: AI + Lead Intelligence (Phases 17, 19, 25)

### Phase 17: Lead Scoring AI -- BACKEND ONLY
`ai-lead-scorer` edge function (511 lines, real OpenAI logic) exists. `LeadScoreDashboard`, `AILeadScorer`, `LeadScoringActions` components exist.

**Work:**
- Verify automation trigger fires on new lead creation
- Add lead score badge display on pipeline cards
- Ensure bulk rescore works end-to-end
- Estimated: 2 component edits

### Phase 19: Proposal Analytics -- BACKEND ONLY
`proposal-engagement-tracker` edge function exists. `ProposalAnalyticsDashboard` and `ProposalAnalytics` components exist with real Supabase queries.

**Work:**
- Polish dashboard with time-on-section visualization
- Ensure tracking pixel is embedded in shared proposal views
- Add re-visit tracking alerts
- Estimated: 2 component edits

### Phase 25: Pipeline Forecasting -- BACKEND ONLY
`predictive-analytics-engine` and `financial-forecasting-ai` edge functions exist. `financial_forecasts` table exists. No frontend dashboard.

**Work:**
- Create `PipelineForecastDashboard.tsx` with weighted pipeline by month chart
- Show win probability adjustments and revenue projections
- Add to analytics/reports section
- Estimated: 1 new dashboard component

---

## Batch 5: Dialer + Voice (Phases 20, 21, 22, 23, 24)

### Phase 20: Power Dialer Triple-Line Mode -- PARTIAL
`triple-line-dialer` edge function exists. `TripleLineDialer.tsx` component exists. `PowerDialerAgent` page exists with session management.

**Work:**
- Create campaign management UI (create/edit campaigns, add lead lists)
- Wire `TripleLineDialer` into the `PowerDialerAgent` page
- Add real-time call status indicators
- Estimated: 2 new components, 1 integration

### Phase 21: Voicemail Detection and Auto-Drop -- BACKEND ONLY
`voicemail-drop` edge function (220 lines) exists. `voicemail_templates` table exists. No UI.

**Work:**
- Create `VoicemailTemplateManager.tsx` for recording/uploading scripts
- Integrate AMD detection toggle into dialer settings
- Estimated: 1 new component

### Phase 22: Call Recording Transcription -- PARTIAL
`voice-transcribe` and `transcripts-ingest` edge functions exist. `CallTranscriptViewer` and `LiveCallTranscript` components exist in AI Agent dashboard.

**Work:**
- Add keyword highlighting and sentiment badges to transcript viewer
- Add transcript summary panel
- Wire into call detail views across the CRM (not just AI Agent dashboard)
- Estimated: 2 component edits

### Phase 23: Meeting Scheduler -- BACKEND ONLY
`smart-scheduler` edge function (269 lines, real slot logic) exists. No frontend.

**Work:**
- Create DB migration for `meeting_bookings` table
- Create `MeetingSchedulerWidget.tsx` -- booking link generator
- Create public booking page for customers
- Add appointment confirmation flow with SMS/email
- Estimated: 3 new components, 1 migration

### Phase 24: Sales Rep Leaderboard -- PARTIAL
`CompetitionLeaderboard` and `CanvasserLeaderboardPage` exist for canvassing. No sales-specific leaderboard.

**Work:**
- Create `SalesLeaderboard.tsx` tracking calls, appointments, proposals, closes
- Add gamification badges and ranking tiers
- Add to main dashboard or dedicated route
- Estimated: 1 new component

---

## Batch 6: Sales Intelligence (Phases 26, 27, 28, 29, 30)

### Phase 26: Re-engagement Campaigns -- NEW
**Work:**
- Create `ReEngagementCampaign.tsx` settings panel
- Define rules: auto-target cold leads after 30/60/90 days
- Wire to email sequence engine and SMS auto-responder
- Estimated: 1 new component, automation rules

### Phase 27: Competitor Price Comparison -- NEW
**Work:**
- Create `CompetitorBenchmark.tsx` component
- Store market rate data, compare against estimates
- Display as sidebar widget on estimate builder
- Estimated: 1 new component

### Phase 28: Proposal Version Control -- PARTIAL
Enhanced estimates already have versioning. Need diff view.

**Work:**
- Create `EstimateVersionHistory.tsx` showing version diffs
- Add "Compare Versions" button on estimate detail
- Estimated: 1 new component

### Phase 29: Smart Follow-up Reminders -- BACKEND ONLY
`smart-follow-up` and `ai-followup-dispatch` edge functions exist.

**Work:**
- Create notification UI for AI-suggested follow-up timing
- Add snooze/dismiss/act controls on reminders
- Estimated: 1 new component

### Phase 30: Win/Loss Analysis Dashboard -- NEW
**Work:**
- Create `WinLossAnalysis.tsx` dashboard
- Query closed-won vs closed-lost pipeline entries
- Show reasons, patterns, rep performance
- Estimated: 1 new dashboard component

---

## Batch 7: Field Operations (Phases 31, 32, 33, 34, 35, 36)

### Phase 31: Territory Heat Maps -- DONE
`AreaHeatmapOverlay`, `canvass-area-build-heatmap` edge function exist with real Mapbox integration. Already functional in StormCanvass.

### Phase 32: Route Optimization -- DONE
`CrewRouteOptimizer` component and `canvass-route-plan` edge function exist. Wired into `DispatchDashboard`.

### Phase 33: Door-to-Door Canvassing Tracker -- DONE
Full StormCanvass system with `TerritoryManagerMap`, pin tracking, disposition logging already implemented.

### Phase 34: GPS-Enforced Photo Requirements -- PARTIAL
GPS tracking exists in photo components. Need strict enforcement.

**Work:**
- Add GPS validation check before photo upload is accepted
- Show warning/block if EXIF GPS data is missing
- Add manual geocoding fallback
- Estimated: 1 component edit

### Phase 35: Before/After Photo Comparisons -- NEW
**Work:**
- Create `BeforeAfterSlider.tsx` component with drag slider
- Auto-pair photos by category (before/after) per job
- Estimated: 1 new component

### Phase 36: Photo Annotation Tools -- PARTIAL
Fabric.js is installed. SmartDocs has annotation capabilities.

**Work:**
- Create `PhotoAnnotator.tsx` with draw arrows, circles, text
- Integrate into job photo viewer
- Estimated: 1 new component

---

## Batch 8: Field Operations Continued (Phases 37, 38, 39, 40, 41, 42)

### Phase 37: Material Delivery Tracking -- BACKEND ONLY
`material-fulfillment-tracker` and `material-order-processor` edge functions exist.

**Work:**
- Create `MaterialDeliveryTracker.tsx` with ETA and confirmation status
- Wire into project/job detail page
- Estimated: 1 new component

### Phase 38: Crew Assignment and Dispatch -- DONE
`JobAssignmentBoard` and `DispatchDashboard` with `LiveCrewTracker` exist and are functional.

### Phase 39: Daily Production Reports -- BACKEND ONLY
`project-progress-reporter` edge function exists.

**Work:**
- Create `DailyProductionReport.tsx` auto-generated summary per crew
- Add to dispatch dashboard
- Estimated: 1 new component

### Phase 40: Safety Checklist Enforcement -- NEW
**Work:**
- Create `SafetyChecklist.tsx` with required items before production start
- Add gate to production workflow
- Estimated: 1 new component, 1 migration for checklist items

### Phase 41: Equipment/Tool Tracking -- BACKEND ONLY
`fleet-manager` and `equipment-maintenance-scheduler` edge functions exist.

**Work:**
- Create `EquipmentInventory.tsx` management page
- Track assignment to crews, maintenance schedules
- Estimated: 1 new component

### Phase 42: Subcontractor Management -- PARTIAL
`SubcontractorManagement.tsx` component exists. `subcontractor-portal-manager` and `subcontractor-payment-processor` edge functions exist.

**Work:**
- Polish existing component, wire to edge functions
- Add compliance document tracking
- Estimated: 1 component edit

---

## Batch 9: Production + Permits (Phases 43, 44, 45)

### Phase 43: Permit Status Dashboard -- BACKEND ONLY
`permit-application-generator`, `permit-detect-jurisdiction`, `scrape-county-permits` edge functions exist. `PermitExpediter` page exists.

**Work:**
- Add permit status tracking view to project detail
- Show application status, approval dates, inspection scheduling
- Estimated: 1 component edit

### Phase 44: Inspection Scheduling -- BACKEND ONLY
`inspection-scheduler` edge function exists.

**Work:**
- Create `InspectionScheduler.tsx` widget
- Auto-schedule at production milestones
- Estimated: 1 new component

### Phase 45: Punch List Management -- NEW
`punch-list-processor` edge function exists.

**Work:**
- Create `PunchListManager.tsx` for tracking final walkthrough items
- Add photo evidence per punch item
- Mark complete/incomplete with signatures
- Estimated: 1 new component

---

## Batch 10: Measurement + Estimation (Phases 46, 47, 48, 49, 50, 51, 52, 53, 54, 55)

### Phase 46: AI Roof Measurement from Satellite -- DONE
Full measurement system with `ai-measurement-analyzer`, `calculate-roof-measurements`, satellite imagery, and worksheet engine.

### Phase 47: 3D Property Model Viewer -- PARTIAL
`detect-building-structure` edge function exists. No 3D viewer.

**Work:**
- Create `PropertyModelViewer.tsx` using Three.js or Konva
- Render roof planes from measurement data
- Estimated: 1 new component

### Phase 48: Waste Factor Calculator -- DONE
Waste factor calculations integrated into measurement worksheet engine and estimate calculator.

### Phase 49: Supplier Price Feed -- PARTIAL
`abc-pricing`, `srs-pricing`, `qxo-pricing`, `srs-pricelist-importer` edge functions exist.

**Work:**
- Create `SupplierPriceFeed.tsx` showing live prices
- Wire into estimate line item pricing
- Estimated: 1 new component

### Phase 50: Material Takeoff Generator -- DONE
`calculate-materials` edge function exists. Material calculations integrated into estimates.

### Phase 51: Multi-Trade Estimation -- PARTIAL
Estimate system exists for roofing. Need to extend for siding, gutters, windows.

**Work:**
- Add trade type selector to estimate builder
- Add trade-specific line item templates
- Estimated: 2 component edits

### Phase 52: Labor Cost Calculator -- PARTIAL
Labor costs exist in estimates. Need region-adjusted rates.

**Work:**
- Create `LaborRateManager.tsx` in settings
- Add region/complexity modifiers
- Estimated: 1 new component

### Phase 53: Change Order Impact Analysis -- PARTIAL
Change orders exist. Need impact visualization.

**Work:**
- Create `ChangeOrderImpact.tsx` showing cost/timeline delta
- Estimated: 1 new component

### Phase 54: Estimate Comparison Tool -- NEW
**Work:**
- Create `EstimateComparison.tsx` side-by-side diff view
- Estimated: 1 new component

### Phase 55: Measurement Accuracy Scoring -- DONE
`MeasurementCorrectionsLog`, confidence scores, accuracy tiers all implemented in measurement system.

---

## Batch 11: Insurance + Claims (Phase 56)

### Phase 56: Insurance Claim Workflow -- DONE
`InsuranceClaimManager.tsx` with full status tracking, `insurance-claim-tracker` edge function, `ScopeDocumentBuilder` with Xactimate compatibility all exist and are functional.

---

## Implementation Summary

| Status | Count | Phases |
|--------|-------|--------|
| DONE (no work needed) | 12 | 7, 9, 10, 18, 31, 32, 33, 38, 46, 48, 50, 55, 56 |
| BACKEND ONLY (needs UI) | 17 | 8, 11, 12, 15, 16, 17, 19, 21, 23, 25, 29, 37, 39, 41, 43, 44, 49 |
| PARTIAL (needs completion) | 14 | 13, 14, 20, 22, 24, 28, 34, 36, 42, 47, 51, 52, 53, 54 |
| NEW (build from scratch) | 7 | 26, 27, 30, 35, 40, 45 |

### Total New Components to Build: ~40
### Total Component Edits: ~15
### Database Migrations Needed: 3 (invoices, meeting_bookings, safety_checklists)
### Edge Functions to Implement: 1 (financing-application-processor)

---

## Recommended Build Order

Due to Lovable's per-message architecture, I recommend building 3-4 phases per session:

1. **Session 1**: Phases 8, 12, 13 (Communications + Invoicing)
2. **Session 2**: Phases 11, 14, 15 (Email Sequences + Financing + Surveys)
3. **Session 3**: Phases 16, 17, 19 (Referrals + Lead Scoring + Proposal Analytics)
4. **Session 4**: Phases 20, 21, 22 (Dialer + Voicemail + Transcription)
5. **Session 5**: Phases 23, 24, 25 (Scheduler + Leaderboard + Forecasting)
6. **Session 6**: Phases 26, 27, 28, 29, 30 (Sales Intelligence -- lighter phases)
7. **Session 7**: Phases 34, 35, 36, 37 (Field Ops -- Photo/Material)
8. **Session 8**: Phases 39, 40, 41, 42 (Production + Subcontractors)
9. **Session 9**: Phases 43, 44, 45 (Permits + Inspections + Punch Lists)
10. **Session 10**: Phases 47, 49, 51, 52, 53, 54 (Measurement + Estimation polish)

Shall I begin with **Session 1** (Phases 8, 12, 13)?
