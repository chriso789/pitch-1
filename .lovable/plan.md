

# 100-Phase Roadmap + Begin Phase 19

## Overview

This plan creates a comprehensive `ROADMAP_100_PHASES.md` document covering the next 100 phases (Phases 19-118) organized into 9 functional tiers, then immediately implements **Phase 19** as the first new work.

Based on codebase analysis, Phases 1-18 are complete (document sharing, unified comms, weather, address validation, SMS auto-response, invoicing, surveys, referrals, storm canvassing core, and more). The roadmap below picks up from Phase 19.

---

## Part 1: The Roadmap Document

A new `ROADMAP_100_PHASES.md` file will be created with all 100 phases structured as follows:

### Tier 1: Revenue and Customer Experience (Phases 19-30)
| Phase | Feature | Description |
|-------|---------|-------------|
| 19 | Customer Portal Payment Dashboard | Stripe payment status, invoice history, and pay-now buttons on the homeowner portal |
| 20 | Good/Better/Best Proposal Builder | Three-tier pricing comparison with interactive selection and instant e-sign |
| 21 | Financing Calculator Widget | Embedded monthly payment calculator with configurable APR and terms |
| 22 | Automated Review Collection | Post-completion Google/Yelp review request flow with SMS + email drip |
| 23 | Referral Reward Fulfillment | Automated gift card or credit issuance when referral converts |
| 24 | Customer Satisfaction NPS Tracker | NPS score trending dashboard with alerts on detractors |
| 25 | Upsell/Cross-Sell Recommendation Engine | AI suggests gutter, siding, or solar add-ons based on property data |
| 26 | Subscription Maintenance Plans | Recurring annual inspection plans with auto-billing |
| 27 | Customer Lifecycle Stage Automation | Auto-move contacts through lifecycle stages (prospect to advocate) |
| 28 | Multi-Language Proposal Support | Generate proposals in Spanish, Portuguese, and Creole |
| 29 | Video Testimonial Capture | In-app video recording and publishing to proposal gallery |
| 30 | Loyalty Program Points System | Points for referrals, reviews, repeat business redeemable for discounts |

### Tier 2: Sales Optimization (Phases 31-42)
| Phase | Feature | Description |
|-------|---------|-------------|
| 31 | AI Lead Scoring v2 | Multi-signal scoring: property age, storm proximity, equity, engagement |
| 32 | Predictive Close Date | ML model predicting deal close date based on pipeline velocity |
| 33 | Sales Playbook Library | Templated scripts and objection handlers by lead source |
| 34 | Competitive Battle Cards | Side-by-side comparison cards vs common competitors |
| 35 | Pipeline Velocity Dashboard | Average days per stage, bottleneck detection, conversion funnels |
| 36 | Commission Calculator and Tracker | Real-time commission visibility per rep with split deal support |
| 37 | Automated Follow-Up Sequences | Multi-touch cadences (call + SMS + email) triggered by stage changes |
| 38 | Meeting Recording and Transcription | Record field meetings via mobile, auto-transcribe with key takeaways |
| 39 | Proposal A/B Testing | Track which proposal templates convert best by job type |
| 40 | Deal Desk Approval Workflow | Margin-based auto-approve or escalate for discount requests |
| 41 | Win/Loss Analysis Dashboard | AI-analyzed reasons for closed-won and closed-lost trends |
| 42 | Territory Heat Map Analytics | Revenue density, untapped opportunity zones, rep coverage gaps |

### Tier 3: Field Operations (Phases 43-54)
| Phase | Feature | Description |
|-------|---------|-------------|
| 43 | Crew Scheduling Calendar | Drag-and-drop crew assignment with conflict detection |
| 44 | GPS Crew Tracking | Real-time crew location on map with geofence check-in/out |
| 45 | Digital Punch List | Photo-annotated punch list items with homeowner sign-off |
| 46 | Equipment and Vehicle Tracker | Assign tools/trucks to crews, track maintenance schedules |
| 47 | Safety Compliance Checklist | Pre-job safety checklist with photo evidence and sign-off |
| 48 | Time Clock with Geofencing | Clock in/out only when within job-site geofence |
| 49 | Subcontractor Portal | Sub-specific login with assigned jobs, docs, and payment status |
| 50 | Weather-Based Auto-Reschedule | Auto-propose new dates when weather cancels a production day |
| 51 | Material Delivery Tracking | Real-time delivery status from supplier to job site |
| 52 | Daily Production Log | End-of-day summary: photos, progress %, materials used, notes |
| 53 | Permit Status Auto-Check | Scrape county portals for permit approval status updates |
| 54 | Job Site Directions and Routing | Optimized multi-stop routes for field reps with turn-by-turn |

### Tier 4: Measurement and Estimation (Phases 55-66)
| Phase | Feature | Description |
|-------|---------|-------------|
| 55 | Multi-Vendor Report Ingestion | Parse EagleView, Hover, ScopeX, and GAF reports into unified schema |
| 56 | AI Roof Pitch Detection v2 | Shadow-analysis and multi-angle photo pitch estimation |
| 57 | Gutter and Downspout Calculator | Linear footage calculation with automatic placement recommendations |
| 58 | Siding Measurement Module | Wall area calculations with window/door deductions |
| 59 | Supplier Price Book Integration | Live pricing from ABC, SRS, QXO, Sunniland with auto-refresh |
| 60 | Estimate Version Control | Full version history with diff view between estimate revisions |
| 61 | Profit Margin Slider | Interactive slider adjusting total price with live margin preview |
| 62 | Waste Factor Intelligence | Dynamic waste factor by roof complexity, pitch, and material type |
| 63 | Material Takeoff Export | Export BOMs to CSV, Excel, or direct supplier order format |
| 64 | Accessory Auto-Calculator | Auto-add ice and water, starter, ridge cap, vents from measurements |
| 65 | Labor Rate Matrix | Configurable labor rates by job type, difficulty, and region |
| 66 | Estimate Approval Workflow | Manager sign-off required before estimate leaves the office |

### Tier 5: Insurance and Claims (Phases 67-76)
| Phase | Feature | Description |
|-------|---------|-------------|
| 67 | Xactimate Integration | Import/export Xactimate ESX files with line item mapping |
| 68 | Supplement Request Generator | AI-drafted supplement letters with measurement evidence |
| 69 | Insurance Adjuster Meeting Scheduler | Coordinated scheduling between homeowner, adjuster, and rep |
| 70 | Depreciation Calculator | Recoverable vs non-recoverable depreciation tracking |
| 71 | Claim Status Timeline | Visual timeline of claim milestones with document links |
| 72 | Carrier-Specific Templates | Pre-built scope formats for State Farm, Allstate, USAA, etc. |
| 73 | Photo Evidence Packager | Auto-compile damage photos into adjuster-ready PDF packets |
| 74 | Mortgage Company Payment Tracker | Track two-party check endorsement and release status |
| 75 | COC/AOB Document Generator | Certificate of Completion and Assignment of Benefits templates |
| 76 | Insurance Revenue Forecasting | Pipeline value weighted by claim approval probability |

### Tier 6: Financial and Accounting (Phases 77-86)
| Phase | Feature | Description |
|-------|---------|-------------|
| 77 | QuickBooks Two-Way Sync | Full bi-directional sync: invoices, payments, customers, items |
| 78 | Accounts Receivable Aging Dashboard | 30/60/90 day aging with auto-reminder escalation |
| 79 | Job Costing Actuals vs Estimate | Side-by-side comparison of estimated vs actual costs per job |
| 80 | Payroll Integration Prep | Export time records in ADP/Gusto format for payroll processing |
| 81 | Tax Report Generator | Sales tax summary by jurisdiction with filing-ready exports |
| 82 | Vendor Payment Scheduling | Track and schedule supplier payments with early-pay discounts |
| 83 | Cash Flow Forecasting | 30/60/90 day cash projection based on pipeline and AR |
| 84 | Change Order Financial Tracking | Track approved change orders impact on job profitability |
| 85 | Multi-Entity Consolidation | Roll up financials across multiple business entities |
| 86 | Budget vs Actual by Department | Department-level spend tracking against monthly budgets |

### Tier 7: Reporting and Analytics (Phases 87-94)
| Phase | Feature | Description |
|-------|---------|-------------|
| 87 | Custom Report Builder | Drag-and-drop report designer with saved report templates |
| 88 | Scheduled Report Delivery | Auto-email PDF/Excel reports on daily/weekly/monthly cadence |
| 89 | Executive KPI Scorecard | Single-screen view of top 10 business health metrics |
| 90 | Sales Leaderboard Gamification | Real-time rep rankings with streak tracking and achievements |
| 91 | Marketing Attribution Dashboard | Track lead source ROI from first touch to closed deal |
| 92 | Operational Efficiency Metrics | Response time, estimate turnaround, production throughput |
| 93 | Customer Cohort Analysis | Retention and LTV analysis by acquisition channel and period |
| 94 | Board-Ready Financial Deck | Auto-generated investor/board presentation with key metrics |

### Tier 8: Automation and AI (Phases 95-106)
| Phase | Feature | Description |
|-------|---------|-------------|
| 95 | Workflow Rule Engine | If/then automation builder: stage changes trigger actions |
| 96 | AI Email Composer | Context-aware email drafting using job, contact, and history data |
| 97 | Smart Task Generator | AI creates task lists from job scope and stage transitions |
| 98 | Document OCR Pipeline | Extract data from uploaded permits, invoices, and insurance docs |
| 99 | Chatbot for Homeowner Portal | AI answers homeowner questions about project status 24/7 |
| 100 | Voicemail Transcription and Routing | Auto-transcribe voicemails and create tasks from content |
| 101 | Predictive Inventory Ordering | Forecast material needs based on pipeline and order materials early |
| 102 | Anomaly Detection Alerts | Flag unusual patterns: margin drops, stalled deals, cost spikes |
| 103 | AI-Powered Quality Inspection | Photo analysis detecting incomplete work or defects |
| 104 | Smart Document Tagging | Auto-classify uploaded documents by type and link to correct job |
| 105 | Natural Language Search | Ask questions like "Show me all roofing jobs over $20k in Miami" |
| 106 | AI Meeting Prep Brief | Pre-appointment summary: property data, history, talking points |

### Tier 9: Platform and Scale (Phases 107-118)
| Phase | Feature | Description |
|-------|---------|-------------|
| 107 | Multi-Location Dashboard | Corporate roll-up view across all branch offices |
| 108 | Role-Based Dashboard Customization | Different default views for admin, manager, rep, and tech |
| 109 | Offline Mode for Field App | Queue actions offline, sync when connectivity returns |
| 110 | Webhook Marketplace | Configurable outbound webhooks for third-party integrations |
| 111 | API Key Management Portal | Self-service API key creation for external system access |
| 112 | White-Label Branding Engine | Full theme customization: colors, logos, domain, email templates |
| 113 | SSO/SAML Authentication | Enterprise single sign-on for large organizations |
| 114 | Data Import/Export Wizard | Bulk CSV/Excel import with field mapping and validation |
| 115 | Audit Trail and Compliance Log | Immutable log of all data changes with user attribution |
| 116 | Performance Monitoring Dashboard | API response times, error rates, user session metrics |
| 117 | Automated Database Backups | Scheduled backups with point-in-time recovery options |
| 118 | Marketplace for Add-On Modules | Plugin architecture for third-party feature extensions |

---

## Part 2: Implement Phase 19 -- Customer Portal Payment Dashboard

### What it does
Adds a payment section to the existing homeowner portal showing invoice history, payment status, and a "Pay Now" button that opens a Stripe payment link.

### Technical changes

**1. New component: `src/features/portal/components/PortalPaymentDashboard.tsx`**
- Fetches invoices linked to the customer's project via Supabase
- Displays invoice list with status badges (Paid, Pending, Overdue)
- Each pending invoice shows a "Pay Now" button that opens the Stripe payment link
- Uses existing `stripe-create-payment-link` edge function

**2. Update `src/pages/HomeownerPortalPage.tsx`**
- Add a "Payments" tab to the portal navigation
- Render the new `PortalPaymentDashboard` component in that tab

**3. Update `src/pages/CustomerPortalPublic.tsx`**
- Add payment section for public portal view if payment links exist

**No new database tables needed** -- leverages existing `invoices` and `stripe_payment_links` tables. No new edge functions needed -- uses existing `stripe-create-payment-link`.

