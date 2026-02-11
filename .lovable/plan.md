

## Add Call Transcript History Viewer to AI Agent Dashboard

### What This Does

Adds a new "Transcripts" tab to the AI Agent Dashboard (`/ai-agent`) that lets you browse and review past AI call conversations -- what the AI said, what the caller said, and the gathered qualification data.

### Current State

- The **AI Agent Settings page** (`/settings/ai-agent`) with greeting, voice, business hours, qualification questions, and test call is already built.
- The **Live Calls tab** shows real-time transcripts for active calls only -- once the call ends, there's no way to review it.
- The `ai_call_transcripts` table stores call summaries (caller number, gathered data, sentiment, duration) but not individual transcript lines.
- The `call_transcripts` table stores line-by-line transcript entries (speaker, text, timestamp) linked by `call_id`.

### Solution

Add a 4th tab **"Transcripts"** to the AI Agent Dashboard that:
1. Lists recent AI calls from `ai_call_transcripts` (caller number, date, duration, sentiment)
2. When you click a call, loads the full conversation from `call_transcripts` and displays it in a chat-bubble view
3. Shows the gathered qualification data (name, service needed, etc.) in a sidebar panel

---

### Changes

#### 1. New Component: `src/components/ai-agent/CallTranscriptViewer.tsx`

A two-panel layout:
- **Left panel**: List of recent AI calls, showing caller number, date, duration, and sentiment badge. Clickable rows.
- **Right panel**: When a call is selected, display:
  - Call metadata (caller, duration, date)
  - Full transcript in chat-bubble format (AI messages left, caller messages right) -- reusing the same visual style as `LiveCallTranscript`
  - Gathered data card showing each qualification answer (name, service, callback number, etc.)
  - If no transcript entries exist for the call, show the gathered data summary only

Data flow:
```text
ai_call_transcripts (call list)
  --> click a call
  --> call_transcripts WHERE call_id = selected.telnyx_call_control_id
  --> render conversation + gathered_data
```

#### 2. Update: `src/pages/AIAgentDashboardPage.tsx`

Add the 4th tab:

| Tab | Icon | Component |
|-----|------|-----------|
| Analytics | BarChart3 | CallAnalyticsDashboard |
| Live Calls | Phone | LiveCallTranscript |
| Transcripts | FileText | CallTranscriptViewer (new) |
| Campaigns | MessageSquare | OutboundCampaignBuilder |

Update `TabsList` from `grid-cols-3` to `grid-cols-4`.

---

### Technical Details

**Files to create:**

| File | Purpose |
|------|---------|
| `src/components/ai-agent/CallTranscriptViewer.tsx` | Browse and review past AI call transcripts |

**Files to modify:**

| File | Change |
|------|--------|
| `src/pages/AIAgentDashboardPage.tsx` | Add Transcripts tab with new component |

**Database queries used (no schema changes needed):**
- `ai_call_transcripts` -- list of AI calls with gathered_data, sentiment, duration
- `call_transcripts` -- line-by-line transcript entries joined by call_id

**No database migrations required** -- all tables already exist.

