

# Phases 7-25 Implementation Plan

## Current State Assessment

After thorough codebase analysis, many of these phases already have **backend infrastructure** (edge functions + database tables) but are missing **frontend UI integration** or have **stub-only edge functions**. Below is the implementation plan organized by effort level.

---

## Phase-by-Phase Status and Work Required

### PHASE 7: Customer Document Sharing
- **Backend**: `customer-portal-access` edge function exists; `EnhancedCustomerPortal` has tabs but NO documents tab
- **Work**: Add a "Documents" tab to the portal showing contracts, change orders, photos filtered by the linked project. Use existing `documents` table filtered by `pipeline_entry_id`/`project_id`
- **Files**: `src/features/portal/components/EnhancedCustomerPortal.tsx`, new `CustomerDocumentsTab.tsx`

### PHASE 8: Unified Communications Timeline
- **Backend**: `UnifiedTimeline.tsx` component EXISTS with SMS, call, email event loading
- **Work**: Wire it into the lead/project detail pages if not already. Verify it loads from `sms_conversations`, `call_sessions`, `email_activity_log`. Add filtering controls
- **Files**: Verify integration in detail pages, minor UI polish

### PHASE 9: Weather Integration for Scheduling
- **Backend**: FULLY IMPLEMENTED -- `weather-forecast` edge function with OpenWeather API, `WeatherWidget`, `CalendarWeatherOverlay`, `WeatherOverlay` components, `weather_cache` and `production_weather_alerts` tables
- **Work**: Minimal -- ensure weather overlay appears on production scheduling calendar. Add auto-pause toggle in settings

### PHASE 10: Address Validation (Google Places)
- **Backend**: `google-address-validation` edge function exists, `AddressAutocomplete` component exists, `addressValidation.ts` utility exists
- **Work**: Ensure all contact/lead creation forms use `AddressAutocomplete` component. Verify the edge function has `GOOGLE_MAPS_API_KEY` secret

### PHASE 11: Automated Email Sequences
- **Backend**: `email-sequence-engine` edge function (292 lines, real logic), `email-sequence-manager` exists, DB tables (`email_sequences`, `email_sequence_steps`, `email_sequence_enrollments`) exist
- **Work**: Build UI for sequence builder (template selection, step timing, enrollment management). Add automation trigger for new leads

### PHASE 12: SMS Auto-Response Agent
- **Backend**: `sms-auto-responder` edge function (269 lines, real logic with keyword triggers), `sms_auto_response_config` table does NOT exist
- **Work**: Create config table, build Settings UI to enable/disable auto-responses, configure keywords, set business hours

### PHASE 13: Invoice Generation from Estimates
- **Backend**: `project_cost_invoices` table exists but no general invoices table. `qbo-invoice-create` exists for QuickBooks
- **Work**: Create `invoices` + `invoice_line_items` tables. Build "Convert to Invoice" button on approved estimates. Invoice list view with status tracking

### PHASE 14: Financing Options Display
- **Backend**: `financing-application-processor` is a STUB (no real logic). `financing_providers` and `proposal_financing` tables exist
- **Work**: Implement the edge function. Build financing calculator widget showing monthly payments on proposals/estimates

### PHASE 15: Customer Satisfaction Surveys
- **Backend**: `request-customer-review` edge function (257 lines, real logic), `satisfaction_surveys` and `customer_reviews` tables exist
- **Work**: Build survey form component, auto-trigger after project completion, NPS dashboard widget

### PHASE 16: Referral Tracking System
- **Backend**: `referral-manager` edge function (real logic), `referral_codes`, `customer_referrals`, `referral_conversions`, `referral_rewards` tables exist
- **Work**: Build referral management UI in settings, referral dashboard widget, integrate with customer portal `ReferralRewardsSection` (already exists)

### PHASE 17: Lead Scoring AI
- **Backend**: `ai-lead-scorer` edge function (511 lines, real OpenAI logic), `LeadScoreDashboard` and `LeadScoring` components exist
- **Work**: Verify scoring runs on new lead creation (automation trigger). Polish dashboard, add score breakdown on lead cards

### PHASE 18: Good/Better/Best Proposal Templates
- **Backend**: FULLY IMPLEMENTED -- `ProposalTierSelector`, `ProposalBuilder`, `PricingComparisonSlideEditor`, `good_tier_total/better_tier_total/best_tier_total` columns in `enhanced_estimates`
- **Work**: Minimal -- ensure template library includes pre-configured G/B/B templates

### PHASE 19: Proposal Analytics
- **Backend**: `proposal-engagement-tracker` edge function (257 lines, real logic), `ProposalAnalytics.tsx` component exists, `proposal_tracking` table exists
- **Work**: Polish the analytics dashboard. Add time-on-section heatmap, re-visit tracking, embed tracking pixel in shared proposals

### PHASE 20: Power Dialer Triple-Line Mode
- **Backend**: `triple-line-dialer` edge function (280 lines, real Telnyx logic), `dialer_campaigns` and `dialer_lists` tables exist
- **Work**: Build dialer campaign UI -- campaign creation, lead list management, real-time call status dashboard, start/stop controls

### PHASE 21: Voicemail Detection and Auto-Drop
- **Backend**: `voicemail-drop` edge function (220 lines, real logic), `voicemail_templates` table exists
- **Work**: Build voicemail template management UI (record/upload scripts), integrate AMD detection into dialer flow

### PHASE 22: Call Recording Transcription
- **Backend**: `voice-transcribe` and `transcripts-ingest` edge functions exist, `call_transcripts` and `ai_call_transcripts` tables exist
- **Work**: Build transcription viewer with keyword highlighting, sentiment badges, summary display. Add to call detail view

### PHASE 23: Meeting Scheduler Integration
- **Backend**: `smart-scheduler` edge function (269 lines, real logic with slot management)
- **Work**: Create `meeting_bookings` table. Build booking link generator, embeddable calendar widget, appointment confirmation flow

### PHASE 24: Sales Rep Leaderboard
- **Backend**: Canvasser leaderboard exists (`LeaderboardPage`, `CompetitionLeaderboard`), but no sales-specific leaderboard
- **Work**: Build `SalesLeaderboard` component tracking calls, appointments, proposals, closes. Gamification with ranks/badges

### PHASE 25: Pipeline Forecasting
- **Backend**: `financial_forecasts` table exists, `predictive-analytics-engine` and `financial-forecasting-ai` edge functions exist
- **Work**: Build forecast dashboard showing weighted pipeline by month, win probability adjustments, revenue projections

---

## Implementation Approach

Due to the massive scope (19 phases), implementation will be batched by session. Each session will tackle 2-3 phases focusing on the highest-impact work.

### Batch 1 (Immediate): Phases with mostly UI work needed
- **Phase 7**: Customer Document Sharing (new portal tab)
- **Phase 9**: Weather Integration (wire existing components)
- **Phase 10**: Address Validation (wire existing components)
- **Phase 18**: G/B/B Templates (verify completeness)

### Batch 2: Database + UI builds
- **Phase 12**: SMS Auto-Response config UI + table
- **Phase 13**: Invoice system (new tables + UI)
- **Phase 15**: Satisfaction surveys UI
- **Phase 16**: Referral management UI

### Batch 3: Edge function completion + UI
- **Phase 11**: Email sequence builder UI
- **Phase 14**: Financing calculator (implement stub)
- **Phase 17**: Lead scoring polish + automation

### Batch 4: Dialer and communications
- **Phase 20**: Triple-line dialer UI
- **Phase 21**: Voicemail management UI
- **Phase 22**: Transcription viewer
- **Phase 8**: Unified timeline polish

### Batch 5: Analytics and scheduling
- **Phase 19**: Proposal analytics dashboard
- **Phase 23**: Meeting scheduler UI + table
- **Phase 24**: Sales leaderboard
- **Phase 25**: Pipeline forecasting dashboard

---

## Technical Summary

| Category | Count |
|----------|-------|
| New database tables needed | 4 (invoices, invoice_line_items, meeting_bookings, sms_auto_response_config) |
| Stub edge functions to implement | 1 (financing-application-processor) |
| New UI components to build | ~25 |
| Existing components to wire/polish | ~15 |
| Phases already mostly complete | 3 (Phase 9, 10, 18) |

### Key Dependencies
- Phase 10 requires `GOOGLE_MAPS_API_KEY` secret
- Phase 9 requires `OPENWEATHER_API_KEY` secret
- Phase 20/21 require `TELNYX_API_KEY` secret
- Phase 14 requires financing provider API keys (GreenSky, Mosaic)

Shall I begin with **Batch 1** (Phases 7, 9, 10, 18) -- the quick wins that wire existing backend infrastructure to the UI?

