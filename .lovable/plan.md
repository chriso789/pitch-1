

# Batch 2 Completion: Survey Dashboard + Referral Management

## Status of Requested Phases

- **Phase 12 (SMS Auto-Response)** -- Already complete. Full config UI in Settings with keyword triggers, business hours, test tool.
- **Phase 13 (Invoice System)** -- Already complete. `JobInvoiceTracker` with CRUD on `project_cost_invoices`, plus cost reconciliation approval flow.
- **Phase 15 (Customer Satisfaction)** -- Partially complete. NPS survey form and edge function exist, but **no admin dashboard** to view/analyze results.
- **Phase 16 (Referral Management)** -- Backend complete (4 tables + edge function), but **no UI dashboard** exists.

## What Will Be Built

### 1. Customer Satisfaction Survey Dashboard (Phase 15)

**New file: `src/pages/SurveyDashboard.tsx`**

A full-page dashboard accessible from the sidebar showing:
- **NPS Score summary cards**: Overall NPS, Promoters/Passives/Detractors counts, response rate
- **Score distribution chart** (Recharts bar chart, 0-10)
- **Survey responses table** with columns: Contact Name, Project, NPS Score, Sentiment badge, Feedback comment, Date
- **Filters**: Date range, survey type, score range
- **Send Survey button**: Opens dialog to select a contact + project and trigger the `send-review-request` edge function
- Data sourced from `satisfaction_surveys` table joined with `contacts` and `jobs`

**New file: `src/features/reviews/components/SurveyAnalytics.tsx`**

Reusable analytics component with:
- NPS calculation: `((promoters - detractors) / total) * 100`
- Trend line over time (monthly NPS)
- Breakdown by survey_type

### 2. Referral Management Dashboard (Phase 16)

**New file: `src/pages/ReferralDashboard.tsx`**

A full-page dashboard with tabbed sections:

**Tab 1 - Overview:**
- Summary cards: Total Referral Codes, Total Conversions, Total Rewards Paid, Conversion Rate
- Recent conversions table from `referral_conversions` joined with contacts
- Top referrers leaderboard

**Tab 2 - Referral Codes:**
- Table of all `referral_codes` with: Code, Customer Name, Reward Type/Value, Uses/Max, Status, Expiry
- "Create Code" dialog: select customer, set reward type (discount/cash/credit), value, max uses, expiry
- Toggle active/inactive
- Uses the existing `referral-manager` edge function (`create_code` action)

**Tab 3 - Conversions:**
- Table of `referral_conversions` with: Referrer, Referred Contact, Code Used, Job, Conversion Value, Date
- "Record Conversion" dialog for manual entry

**Tab 4 - Rewards:**
- Table of `referral_rewards` with: Recipient, Type, Value, Status (pending/paid/expired), Payout Method, Paid Date
- Mark as paid action

### 3. Route + Sidebar Integration

**File: `src/App.tsx`**
- Add route `/surveys` pointing to `SurveyDashboard`
- Add route `/referrals` pointing to `ReferralDashboard`

**File: `src/shared/components/layout/SidebarNavigation.tsx`** (or equivalent sidebar config)
- Add "Surveys" link under a CX/Reviews section with a Star icon
- Add "Referrals" link under the same section with a Gift icon

### 4. No Database Migrations Needed

All required tables already exist:
- `satisfaction_surveys` (nps_score, feedback, contact_id, project_id, survey_type, sentiment, completed_at)
- `referral_codes` (code, customer_id, reward_type, reward_value, max_uses, current_uses, is_active, expires_at)
- `referral_conversions` (referral_code_id, referrer_contact_id, referred_contact_id, job_id, conversion_value)
- `referral_rewards` (referral_conversion_id, recipient_contact_id, reward_type, reward_value, status, paid_at)

All required edge functions already exist:
- `send-review-request` -- sends survey emails/SMS
- `referral-manager` -- create codes, validate, record conversions, get stats

## Technical Approach

- Both dashboards use `useQuery` with tenant-scoped queries via `useActiveTenantId`
- Charts use Recharts (already installed)
- Tables use the existing shadcn Table components
- Dialogs use the existing Dialog/Form patterns
- Both pages wrapped in `GlobalLayout` with `ProtectedRoute`

