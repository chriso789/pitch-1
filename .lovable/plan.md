

# Full System Audit + Facebook Marketing Drop-In Plan

---

## Part 1: System Audit Results

### Security Scan Summary (181 findings)

| Category | Count | Severity |
|---|---|---|
| RLS Enabled, No Policy | ~20 tables | Info |
| Security Definer Views | 3 views | Error |
| Function Search Path Mutable | 7+ functions | Warn |

**Key Issues:**
- Multiple tables have RLS enabled but zero policies, meaning all rows are blocked for authenticated users (or silently return empty). These need either policies added or RLS disabled if they're only accessed via service-role edge functions.
- 3 views use `SECURITY DEFINER`, which bypasses the querying user's RLS. This is intentional for some (like `v_ai_aged_contacts`) but should be reviewed.
- Several `SECURITY DEFINER` functions lack `SET search_path = public`, creating a potential search_path injection risk.

### Stub Edge Functions (No Real Logic)

These 17 edge functions are **empty stubs** that just log and return `{ success: true }`:

`api-key-manager`, `warranty-claim-processor`, `document-generator-engine`, `lead-attribution-tracker`, `project-timeline-builder`, `project-progress-reporter`, `punch-list-processor`, `webhook-manager`, `financing-application-processor`, `marketing-roi-calculator`, plus ~7 more.

If any UI is calling these, users see success but nothing actually happens.

### Recent Fixes Applied
- Manager Approval Queue: `api_respond_to_approval_request` RPC created + UPDATE RLS policy added (working)
- Call Recordings: Download-to-storage + transcription pipeline added to webhook
- Call Log: Phone number now displayed alongside contact name

### Meta/Facebook Marketing Status
- **Meta CAPI edge function**: Fully implemented -- SHA-256 hashing, retry, audit logging
- **Settings UI**: Working -- Pixel ID + Access Token config in Integrations tab
- **Trigger points**: Only fires from `receive-lead` (external webhook). Does NOT fire from:
  - `create-lead-with-contact` (manual lead creation in CRM)
  - Pipeline status changes (e.g., lead -> appointment -> project)
  - Proposal sent/signed events
  - Appointment scheduled events
- **`lead-attribution-tracker`**: Stub -- does nothing
- **`marketing-roi-calculator`**: Stub -- does nothing
- **Client-side Pixel (`fbq`)**: Not installed anywhere
- **`_fbc`/`_fbp` cookie capture**: Not implemented in CRM lead flows

---

## Part 2: Full Facebook Marketing Drop-In

### What This Delivers

A complete Facebook Ads attribution and conversion tracking system that:
1. Fires server-side CAPI events at every key funnel stage
2. Installs the client-side Facebook Pixel for browser-side deduplication
3. Captures `_fbc`/`_fbp` cookies for cross-device matching
4. Tracks UTM parameters through lead attribution
5. Reports ROI per campaign/adset

### Implementation Plan

#### 1. Client-Side Facebook Pixel Installation

**File: `index.html`** -- Add Meta Pixel base code in `<head>` (no-script fallback too). The Pixel ID will be loaded dynamically per tenant, but a base snippet is needed.

**File: `src/hooks/useMetaPixel.ts`** (new) -- Hook that:
- Reads tenant's `pixel_id` from settings
- Initializes `fbq('init', pixelId)` once per session
- Exposes `trackEvent(eventName, params)` for standard events
- Captures `_fbc` and `_fbp` from cookies

**File: `src/App.tsx` or layout** -- Mount the pixel hook at app root for authenticated users.

#### 2. Fire CAPI Events at All Funnel Stages

**File: `supabase/functions/create-lead-with-contact/index.ts`** -- Add fire-and-forget CAPI call (same pattern as `receive-lead`) after lead creation. Event: `Lead`.

**File: `supabase/functions/pipeline-drag-handler/index.ts`** or relevant status change handler -- Fire CAPI events on key stage transitions:
- `Lead` -> `Appointment Set`: event `Schedule`
- `Appointment` -> `Proposal Sent`: event `InitiateCheckout`
- `Proposal Signed` / `Project`: event `Purchase` with `value` = deal amount

**File: `src/hooks/useMetaPixel.ts`** -- Fire matching browser-side `fbq('track', ...)` events with the same `event_id` for deduplication.

#### 3. Implement `lead-attribution-tracker` (Replace Stub)

**File: `supabase/functions/lead-attribution-tracker/index.ts`** -- Real implementation that:
- Accepts `{ action: 'track', tenant_id, contact_id, pipeline_entry_id, source, medium, campaign, ... }`
- Inserts into existing `lead_attribution_events` table
- Supports first-touch and last-touch attribution models
- Links `marketing_sessions` to pipeline entries on conversion

#### 4. Implement `marketing-roi-calculator` (Replace Stub)

**File: `supabase/functions/marketing-roi-calculator/index.ts`** -- Real implementation that:
- Queries `lead_attribution_events` grouped by `source`/`campaign`
- Joins to `pipeline_entries` for revenue data (actual_value or estimated_value)
- Returns per-campaign: spend (from `cost` column), revenue attributed, ROI, lead count, conversion rate

#### 5. Facebook Marketing Dashboard Page

**File: `src/pages/FacebookMarketingDashboard.tsx`** (new) -- Dashboard showing:
- CAPI event delivery status (from `audit_log` where `table_name = 'meta_capi'`)
- Lead attribution breakdown by source/campaign
- Funnel visualization: Leads -> Appointments -> Proposals -> Projects
- ROI per campaign (calls `marketing-roi-calculator`)
- Recent CAPI events log

**Route**: Add to router as `/marketing/facebook`

#### 6. Enhanced `_fbc`/`_fbp` Cookie Capture

**File: `src/components/EnhancedLeadCreationDialog.tsx`** -- When creating a lead, capture `_fbc`/`_fbp` cookies from `document.cookie` and pass them through to the CAPI call as `custom_data.fbc` / `custom_data.fbp`.

**File: `supabase/functions/meta-capi/index.ts`** -- Accept and forward `fbc`/`fbp` in `user_data` payload to Meta.

### Files Modified/Created

| File | Action |
|---|---|
| `index.html` | Add Meta Pixel base snippet |
| `src/hooks/useMetaPixel.ts` | New -- pixel init + event tracking |
| `src/App.tsx` or layout | Mount pixel hook |
| `supabase/functions/create-lead-with-contact/index.ts` | Add CAPI `Lead` event |
| `supabase/functions/meta-capi/index.ts` | Accept `fbc`/`fbp` cookies |
| `supabase/functions/lead-attribution-tracker/index.ts` | Replace stub with real logic |
| `supabase/functions/marketing-roi-calculator/index.ts` | Replace stub with real logic |
| `src/pages/FacebookMarketingDashboard.tsx` | New dashboard page |
| Router file | Add `/marketing/facebook` route |

### Not Included (Future)
- Meta Ads API integration for pulling ad spend data automatically
- Custom Audiences sync (uploading CRM segments to Meta)
- Lookalike audience generation

