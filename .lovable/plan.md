
# Comprehensive PITCH CRM Implementation Roadmap
## 50 Phases Across 4 Priority Tiers

Based on detailed codebase analysis, here's your complete implementation roadmap organized by business impact and dependencies.

---

## Current Implementation Status Summary

| Category | Implemented | Partial | Missing |
|----------|------------|---------|---------|
| **Core Business Logic** | Manager Approval Queue, Estimate Version Control | Profit Slider (needs estimates integration), C-L-J Numbering | Manager Approval Gate Enforcement |
| **Customer Experience** | Customer Portal (basic), Project Timeline, Messages | Payment Links API | Stripe Connect, Customer Document Sharing |
| **Integrations** | Weather Forecast, Google Address Validation, AI Lead Scorer | Unified Timeline | Auto-pause production, SMS/iMessage unification |
| **AI & Scale** | AI Lead Scorer, Territory Manager | Measurement Accuracy Dashboard | Route Optimization, Predictive Analytics |

---

## IMMEDIATE PRIORITY (Phases 1-5)
### Core Business Logic That Blocks Revenue

### Phase 1: Manager Approval Gate Enforcement
**Status**: UI exists, enforcement missing
**Current**: `ManagerApprovalQueue` component works, but pipeline drag-drop bypasses approval

**Implementation**:
```text
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Lead in Pipeline│────▶│ Drag to Project  │────▶│ Check if >$25K  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                         │
                              ┌──────────────────────────┴───────────────┐
                              │                                          │
                              ▼                                          ▼
                    ┌─────────────────┐                     ┌─────────────────┐
                    │ Under $25K      │                     │ Over $25K       │
                    │ Direct Convert  │                     │ Show Approval   │
                    └─────────────────┘                     │ Dialog          │
                                                            └─────────────────┘
                                                                     │
                                                                     ▼
                                                            ┌─────────────────┐
                                                            │ Submit to Queue │
                                                            │ Move to "Pending│
                                                            │ Approval" stage │
                                                            └─────────────────┘
```

**Changes Required**:
- `src/components/pipeline/PipelineBoard.tsx` - Add check before allowing Project column drop
- `src/features/pipeline/hooks/usePipelineDrag.ts` - Enforce approval gate in drag handler
- Add "Pending Approval" pipeline stage between Lead and Project
- Wire up `api_approve_job_from_lead` RPC to approval flow

---

### Phase 2: Estimate-to-Profit Slider Integration
**Status**: Components exist separately, not connected
**Current**: `ProfitSlider` exists, estimates have pricing, but slider doesn't update estimate totals

**Implementation**:
- Connect `ProfitSlider` to `MultiTemplateSelector`
- Add `api_estimate_compute_pricing` RPC call when slider moves
- Show real-time total updates in `EstimatePreviewPanel`
- Store profit margin in estimate record for auditing

**Database**: Add `profit_margin_percent` and `profit_mode` columns to estimates table

---

### Phase 3: Estimate Version Snapshot Triggers
**Status**: Version UI exists, automatic snapshots incomplete
**Current**: Manual versioning works via `EstimateVersionControl`, but changes don't auto-snapshot

**Implementation**:
- Add database trigger: `CREATE TRIGGER on_estimate_update AFTER UPDATE ON estimates` 
- Trigger should call `create_estimate_version_snapshot()` function
- Only create snapshot if line_items, totals, or profit changed (ignore status-only changes)
- Add version diff highlighting in `EstimateVersionDiff` component

---

### Phase 4: C-L-J Number Display Enhancement
**Status**: Partial - numbers exist, display inconsistent
**Current**: `CLJBadge` component exists, but format isn't consistent across all views

**Implementation**:
- Standardize format: `C{contact_sequence}-L{lead_sequence}-J{job_sequence}` 
- Add to: Pipeline cards, Estimate headers, Project headers, Customer Portal
- Create `useCLJNumber` hook for consistent formatting
- Add search by C-L-J number in global search

---

### Phase 5: Production Gate Enforcement
**Status**: Gates defined, not enforced
**Current**: NOC/Permit checkboxes exist but don't block progression

**Implementation**:
- Add validation before production stage transitions
- Required documents per gate (e.g., "Pre-Work Photo" before "Work Started")
- Manager override capability with audit logging
- Visual indicators showing missing requirements

---

## SHORT-TERM PRIORITY (Phases 6-15)
### Customer-Facing Features for Conversion

### Phase 6: Customer Portal Payment Integration
**Status**: Portal exists, payment links API ready, not connected
**Current**: `CustomerPortal` shows projects/payments but no "Pay Now" buttons

**Implementation**:
- Add "Make Payment" button in Payments tab
- Call `stripe-create-payment-link` edge function
- Store payment link in `payment_links` table
- Handle webhook for payment completion
- Update project financials automatically

---

### Phase 7: Customer Document Sharing
**Status**: Not implemented
**Current**: Documents stay internal only

**Implementation**:
- Create `customer_shared_documents` table
- Add "Share with Customer" toggle in Document uploads
- Show shared documents in Customer Portal Documents tab
- Enable proposal/estimate PDF viewing
- Add download tracking for analytics

---

### Phase 8: Customer Portal Authentication
**Status**: Basic implementation exists
**Current**: Uses `customer_portal_tokens` but lacks proper auth flow

**Implementation**:
- Magic link email authentication
- Token expiration handling (24 hours)
- Remember device option
- Session management
- Audit log of portal access

---

### Phase 9: Stripe Connect for Subcontractor Payments
**Status**: Not implemented
**Current**: Payment links work for customer collection only

**Implementation**:
- Enable Stripe Connect onboarding for subcontractors
- Create `subcontractor_stripe_accounts` table
- Build payout scheduling system
- Track payment status (pending/paid/failed)
- Generate 1099 reports at year end

---

### Phase 10: E-Signature Enhancement
**Status**: DocuSign integration exists, needs polish
**Current**: `docusign-create-envelope` works but UX is fragmented

**Implementation**:
- Inline signature preview in estimate flow
- One-click "Send for Signature" from estimate
- Real-time signature status updates
- Signed document auto-filing
- Trigger automations on signature completion

---

### Phase 11: Proposal Template Library
**Status**: Estimate templates exist, proposal templates missing
**Current**: Can create estimates, no branded proposal wrapper

**Implementation**:
- Separate proposal templates from estimate templates
- Cover page designs with company branding
- About Us / Testimonials sections
- Photo galleries from job photos
- Warranty information templates

---

### Phase 12: Multi-Option Good/Better/Best Proposals
**Status**: Partially implemented in pricing
**Current**: Can create different estimates, can't combine into one proposal

**Implementation**:
- Create `proposal_options` table linking multiple estimates
- Side-by-side comparison view
- Customer can select option in portal
- Auto-update pipeline with selected option
- Track which options convert best

---

### Phase 13: Proposal Analytics Dashboard
**Status**: View tracking exists, dashboard missing
**Current**: `record-view-event` logs views, no visualization

**Implementation**:
- Create analytics dashboard for proposals
- Time-on-page tracking
- Section engagement heatmap
- Follow-up trigger when viewed but not signed
- A/B testing for proposal elements

---

### Phase 14: SMS Quick Reply Templates
**Status**: SMS sending works, templates incomplete
**Current**: Can send SMS via `telnyx-send-sms`, no template library

**Implementation**:
- Create SMS template library
- Variable substitution ({{first_name}}, {{appointment_time}})
- One-tap templates in SMS composer
- Track template performance
- A/B test message variations

---

### Phase 15: Email Sequence Builder Enhancement
**Status**: Email sequences exist, builder needs work
**Current**: `email-sequence-engine` processes, UI limited

**Implementation**:
- Visual sequence builder (drag-drop steps)
- Conditional branching (if opened, if clicked)
- Dynamic content blocks
- Sequence performance analytics
- Easy duplication of proven sequences

---

## MEDIUM-TERM PRIORITY (Phases 16-30)
### Integrations That Save Manual Work

### Phase 16: Address Validation Auto-Correct
**Status**: API works, auto-correct not implemented
**Current**: `google-address-validation` returns suggestions, not applied

**Implementation**:
- Show validation results in address form
- Auto-fill structured components (street, city, state, zip)
- Flag undeliverable addresses
- Store validation metadata for marketing compliance
- Geocode all addresses automatically

---

### Phase 17: Weather Production Pause
**Status**: Weather data available, pause logic missing
**Current**: `weather-forecast` returns risk levels, no action taken

**Implementation**:
```text
Daily Cron (6 AM):
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Fetch Weather    │────▶│ Check Each       │────▶│ If Risk = High   │
│ for All Projects │     │ Active Project   │     │ Mark as "Weather │
└──────────────────┘     └──────────────────┘     │ Hold"            │
                                                   └──────────────────┘
                                                            │
                                                            ▼
                                                   ┌──────────────────┐
                                                   │ Notify PM +      │
                                                   │ Customer         │
                                                   └──────────────────┘
```

**Implementation**:
- Add `weather_status` column to projects
- Create cron job to check weather daily
- Auto-set "Weather Hold" status when risk is high
- Notify project manager and customer
- Resume when weather clears

---

### Phase 18: Unified Communications Timeline Enhancement
**Status**: Implemented, needs more sources
**Current**: `UnifiedTimeline` shows call/email/sms/note, missing iMessage

**Implementation**:
- Add iMessage webhook ingestion (via third-party bridge)
- Add voicemail transcription display
- Add scheduled appointment events
- Add document signature events
- Real-time updates via Supabase Realtime

---

### Phase 19: GPS Photo Enforcement
**Status**: Partial implementation
**Current**: GPS extraction attempted, fallback unclear

**Implementation**:
- Require GPS in EXIF for field photos
- If no GPS: prompt for manual address entry
- Geocode address to coordinates
- Store photo location in `photos.gps_location`
- Map view of all project photos

---

### Phase 20: Supplier Pricing Integration
**Status**: Edge functions exist, needs UI
**Current**: `abc-pricing`, `srs-pricing`, `qxo-pricing` APIs ready

**Implementation**:
- Pricing lookup component in estimate builder
- Real-time price fetching on material selection
- Price comparison across suppliers
- Auto-update estimate when prices change
- Price history tracking for trends

---

### Phase 21: Material Order Generation
**Status**: Partial implementation
**Current**: `create-material-order` exists, needs estimate connection

**Implementation**:
- "Generate Order" button from approved estimate
- Pre-fill quantities from estimate line items
- Select supplier from integrated options
- Send order via API or email
- Track order status and delivery

---

### Phase 22: Inventory Tracking
**Status**: Edge functions exist, no UI
**Current**: `inventory-manager` API ready

**Implementation**:
- Warehouse inventory dashboard
- Material usage from orders
- Auto-deduct on job completion
- Reorder alerts at threshold
- Multi-location inventory

---

### Phase 23: Crew Scheduling Calendar
**Status**: Partial implementation
**Current**: Scheduling components exist, calendar view incomplete

**Implementation**:
- Full calendar view with crew assignments
- Drag-drop job scheduling
- Conflict detection
- Weather overlay on calendar
- Mobile crew app integration

---

### Phase 24: Crew GPS Tracking
**Status**: Edge function ready
**Current**: `crew-gps-sync` API exists, no live tracking UI

**Implementation**:
- Real-time map showing crew locations
- Geofence job site boundaries
- Auto clock-in/out at job site
- Mileage tracking for expenses
- Route optimization suggestions

---

### Phase 25: Timesheet Processing
**Status**: Edge function ready
**Current**: `crew-timesheet-processor` exists

**Implementation**:
- Mobile timesheet entry
- Manager approval workflow
- Overtime calculations
- Payroll export (CSV/API)
- Labor cost tracking per job

---

### Phase 26: Subcontractor Portal
**Status**: Edge function exists
**Current**: `subcontractor-portal-manager` API ready

**Implementation**:
- Subcontractor login portal
- View assigned jobs
- Submit completion photos
- Invoice submission
- Payment status tracking

---

### Phase 27: Warranty Registration
**Status**: Edge function ready
**Current**: `warranty-registration-manager` exists

**Implementation**:
- Auto-create warranty on job completion
- Customer portal warranty view
- Expiration notification system
- Warranty claim submission
- Manufacturer registration integration

---

### Phase 28: Review Request Automation
**Status**: Implemented
**Current**: `request-customer-review` works

**Enhancement**:
- Smart timing based on job type
- Multi-platform (Google, Facebook, Yelp)
- Follow-up for non-responders
- Review response templates
- NPS score tracking

---

### Phase 29: Referral Program
**Status**: Edge functions exist
**Current**: `referral-manager`, `referral-rewards-processor` ready

**Implementation**:
- Referral link generation
- Reward tracking (cash or credit)
- Referral source attribution
- Automated payout processing
- Referrer dashboard

---

### Phase 30: QuickBooks Integration Enhancement
**Status**: Basic sync works
**Current**: `qbo-*` functions exist for invoicing

**Enhancement**:
- Two-way customer sync
- Automatic invoice creation on job completion
- Payment sync from QB to CRM
- Project profitability sync
- Chart of accounts mapping

---

## LONG-TERM PRIORITY (Phases 31-50)
### AI & Scale Features for Competitive Advantage

### Phase 31: Measurement Accuracy Validation
**Status**: Dashboard exists, validation incomplete
**Current**: `MeasurementAccuracyDashboard` shows stats, manual comparison

**Implementation**:
- Upload vendor report comparison
- Side-by-side measurement diff
- Automatic accuracy score calculation
- Trend tracking over time
- Flag systematic errors for algorithm improvement

---

### Phase 32: AI Measurement Enhancement
**Status**: Edge functions exist
**Current**: `ai-measurement-analyzer` partial

**Enhancement**:
- Multi-source imagery fusion
- Confidence scoring per facet
- Manual override with learning
- Benchmark against EagleView/Hover
- Target 98%+ accuracy

---

### Phase 33: Predictive Lead Scoring
**Status**: AI scorer exists
**Current**: `ai-lead-scorer` with weather + engagement

**Enhancement**:
- Historical conversion data training
- Neighborhood analysis
- Property age correlation
- Storm damage proximity
- Seasonal adjustment factors

---

### Phase 34: Sales Coaching AI
**Status**: Edge function exists
**Current**: `ai-sales-coach` API ready

**Implementation**:
- Call transcription analysis
- Objection handling suggestions
- Win/loss pattern detection
- Personalized coaching tips
- Performance benchmarking

---

### Phase 35: Smart Follow-up Suggestions
**Status**: Edge function exists
**Current**: `smart-follow-up` API ready

**Implementation**:
- AI-suggested follow-up timing
- Message content suggestions
- Channel recommendation
- Urgency scoring
- Auto-schedule option

---

### Phase 36: Territory Route Optimization
**Status**: Territory manager exists
**Current**: `territory-manager` CRUD only

**Implementation**:
- Daily route optimization
- Consider appointments + follow-ups
- Traffic-aware routing
- Door-knock sequence optimization
- Territory coverage heat map

---

### Phase 37: Territory Performance Analytics
**Status**: Edge function exists
**Current**: `territory-analytics` API ready

**Implementation**:
- Revenue per territory
- Conversion rate comparison
- Rep performance by territory
- Market penetration metrics
- Territory rebalancing suggestions

---

### Phase 38: Power Dialer Enhancement
**Status**: Components exist
**Current**: `triple-line-dialer`, dialer components

**Enhancement**:
- Parallel line management
- Voicemail detection improvement
- Live transfer capabilities
- Whisper coaching
- Call blending (inbound + outbound)

---

### Phase 39: AI Appointment Scheduling
**Status**: Edge function exists
**Current**: `ai-appointment-scheduler` API ready

**Implementation**:
- Natural language scheduling
- Calendar conflict resolution
- Travel time consideration
- Customer preference learning
- Automated rescheduling

---

### Phase 40: Cross-Sell Analyzer
**Status**: Edge function exists
**Current**: `cross-sell-analyzer` API ready

**Implementation**:
- Identify upsell opportunities
- Bundle recommendations
- Timing optimization
- Success rate tracking
- Rep suggestions during calls

---

### Phase 41: Financial Forecasting
**Status**: Edge function exists
**Current**: `financial-forecasting-ai` API ready

**Implementation**:
- Revenue projection models
- Pipeline weighted forecasting
- Seasonal adjustment
- Resource planning insights
- Cash flow predictions

---

### Phase 42: Competitive Pricing Intelligence
**Status**: Not implemented
**Current**: No competitor tracking

**Implementation**:
- Market rate database
- Win/loss price analysis
- Pricing optimization suggestions
- Margin protection alerts
- Regional pricing variations

---

### Phase 43: Customer Retention AI
**Status**: Edge function exists
**Current**: `customer-retention-ai` API ready

**Implementation**:
- Churn prediction scoring
- Re-engagement campaigns
- Maintenance reminder automation
- Loyalty program integration
- Lifetime value optimization

---

### Phase 44: SLA Monitoring
**Status**: Edge function exists
**Current**: `sla-monitor` API ready

**Implementation**:
- Response time tracking
- Escalation automation
- Customer-facing SLA dashboard
- Performance reporting
- Alert management

---

### Phase 45: Multi-Location Hub
**Status**: Edge function exists
**Current**: `multi-location-hub` API ready

**Implementation**:
- Location-level dashboards
- Cross-location reporting
- Centralized settings management
- Location performance comparison
- Resource sharing between locations

---

### Phase 46: Franchise Management
**Status**: Edge functions exist
**Current**: `franchise-manager`, `franchise-royalty-processor`

**Implementation**:
- Franchisee onboarding
- Royalty calculation
- Brand compliance monitoring
- Training content delivery
- Performance benchmarking

---

### Phase 47: Platform Analytics Dashboard
**Status**: Edge function exists
**Current**: `platform-analytics` API ready

**Implementation**:
- Master admin overview
- Cross-company benchmarks
- Feature adoption metrics
- Revenue analytics
- Growth projections

---

### Phase 48: Compliance Monitoring
**Status**: Edge function exists
**Current**: `compliance-monitor` API ready

**Implementation**:
- License expiration tracking
- Insurance verification
- TCPA compliance
- Document retention policies
- Audit trail reporting

---

### Phase 49: White-Label Customization
**Status**: Not implemented
**Current**: Branding is partial

**Implementation**:
- Custom domain support
- Email domain verification
- Mobile app theming
- Custom login pages
- Brand guideline enforcement

---

### Phase 50: API Partner Program
**Status**: Not implemented
**Current**: Internal APIs only

**Implementation**:
- External API documentation
- OAuth2 partner authentication
- Rate limiting by tier
- Webhook subscriptions
- Partner dashboard

---

## Recommended Implementation Sequence

### Month 1-2: Revenue Blockers
- Phase 1: Manager Approval Gate Enforcement
- Phase 2: Estimate-to-Profit Slider Integration
- Phase 3: Estimate Version Snapshot Triggers
- Phase 6: Customer Portal Payment Integration

### Month 3-4: Customer Experience
- Phase 7: Customer Document Sharing
- Phase 10: E-Signature Enhancement
- Phase 11: Proposal Template Library
- Phase 16: Address Validation Auto-Correct

### Month 5-6: Efficiency Gains
- Phase 17: Weather Production Pause
- Phase 20: Supplier Pricing Integration
- Phase 21: Material Order Generation
- Phase 23: Crew Scheduling Calendar

### Month 7-9: AI & Intelligence
- Phase 31: Measurement Accuracy Validation
- Phase 33: Predictive Lead Scoring
- Phase 36: Territory Route Optimization
- Phase 41: Financial Forecasting

### Month 10-12: Scale & Enterprise
- Phase 45: Multi-Location Hub
- Phase 46: Franchise Management
- Phase 49: White-Label Customization
- Phase 50: API Partner Program

---

## Quick Wins Available Now

These can be implemented in 1-2 hours each:
1. Fix Manager Approval Gate enforcement (add check to drag handler)
2. Connect Profit Slider to estimate calculations
3. Add "Pay Now" button in Customer Portal (API ready)
4. Enable Weather overlay on scheduling views
5. Add C-L-J badge consistently across all headers

