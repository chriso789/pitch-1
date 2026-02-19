

# AI Admin Command Center -- Combined Config Manager + CRM Assistant

## Overview

Build a new "AI Admin" settings tab that provides a full-screen chat interface where admin users can manage system configuration AND get AI-powered CRM assistance through natural language. The AI agent will be able to read and write database-driven settings (pipeline stages, lead sources, automations, templates, etc.) and analyze CRM data -- all through conversation.

## Architecture

The system works by giving the AI agent **tool-calling** capabilities. Instead of asking the model to return JSON text, we define structured tools the agent can invoke. The edge function executes those tools server-side against the database, then returns results to the user.

### Available AI Tools (what the agent can do)

**Config Management Tools:**
- `list_pipeline_stages` -- View all pipeline stages and their order
- `update_pipeline_stage` -- Add, rename, reorder, or delete pipeline stages
- `list_contact_statuses` -- View all contact/qualification statuses
- `update_contact_status` -- Add, rename, or delete contact statuses
- `list_lead_sources` -- View configured lead sources
- `update_lead_source` -- Add or remove lead sources
- `list_automations` -- View automation rules
- `update_automation` -- Enable/disable or modify automation rules
- `update_app_setting` -- Change any app_settings key/value (company name, colors, etc.)
- `list_estimate_templates` -- View estimate templates
- `list_users` -- View team members and roles
- `update_user_role` -- Change a user's role (admin only)

**CRM Intelligence Tools:**
- `query_pipeline_stats` -- Get pipeline counts, values, close rates by stage
- `query_contact_stats` -- Get contact counts by status, source, location
- `query_recent_activity` -- Get recent communications, tasks, lead activity
- `query_stagnant_leads` -- Find leads with no activity in X days
- `query_revenue_summary` -- Revenue by period, rep, location
- `search_contacts` -- Find contacts by name, phone, email
- `search_leads` -- Find pipeline entries by status, value, rep

**Action Tools:**
- `create_contact` -- Add a new contact (existing capability, carried forward)
- `create_task` -- Create a task/reminder (existing capability, carried forward)
- `draft_email` -- Generate email content for a contact
- `draft_sms` -- Generate SMS content for a contact
- `score_lead` -- Analyze and score a specific lead

## What Gets Built

### 1. New Edge Function: `supabase/functions/ai-admin-agent/index.ts`

A new, dedicated edge function that:
- Accepts chat messages with full conversation history
- Streams responses token-by-token via SSE for real-time feel
- Uses the Lovable AI Gateway with tool-calling to let the model invoke config/CRM tools
- Executes tool calls server-side with service-role access (bypasses RLS for admin operations)
- Validates that the requesting user has admin/owner/master role before allowing config writes
- Uses `google/gemini-3-flash-preview` as the default model
- Handles 429/402 rate limit errors gracefully

The system prompt tells the AI it is a PITCH CRM admin assistant that can both configure the system and analyze data. It receives the user's role and tenant context so it knows what it can modify.

### 2. New Page: `src/pages/settings/AIAdminPage.tsx`

A full chat interface with:
- Scrollable message history with markdown rendering
- Streaming token-by-token display as the AI responds
- Message input with send button and Enter-to-send
- Tool execution results shown inline (e.g., "Updated pipeline stage 'Inspection' to position 3")
- Conversation persisted to `ai_chat_sessions` / `ai_chat_messages` with `session_type: 'admin'`
- Role-gated: only `master`, `owner`, `corporate`, `office_admin` can access
- "New Conversation" button to start fresh
- Suggested prompts shown when chat is empty (e.g., "Show me pipeline stages", "How many stagnant leads do we have?", "Add a new lead source called 'Google Ads'")

### 3. Integration into Settings

- Add an "AI Admin" tab to the Settings page under the "system" category
- Tab restricted to `master`, `owner`, `corporate`, `office_admin` roles
- The tab renders the `AIAdminPage` component directly
- Also accessible via route `/settings/ai-admin` for direct navigation

### 4. New Route

- Add `/settings/ai-admin` route in the router pointing to the new page

## Files Created
1. `supabase/functions/ai-admin-agent/index.ts` -- Edge function with tool-calling AI agent
2. `src/pages/settings/AIAdminPage.tsx` -- Full chat UI page
3. `src/components/ai-admin/AIAdminChat.tsx` -- Chat component with streaming, message list, input

## Files Modified
1. `src/features/settings/components/Settings.tsx` -- Add "ai-admin" tab rendering
2. `src/App.tsx` (or router file) -- Add `/settings/ai-admin` route
3. `supabase/config.toml` -- Add `ai-admin-agent` function entry

## Technical Details

### Tool Calling Pattern (Edge Function)

The edge function defines tools as OpenAI-compatible function schemas, sends them with the chat request to the Lovable AI Gateway, and when the model responds with `tool_calls`, the function executes each tool against the database and sends results back to the model for a final response.

```text
User: "Add a pipeline stage called 'Inspection' after 'Qualified Lead'"
  --> AI Gateway call with tools defined
  --> Model returns tool_call: update_pipeline_stage({ action: "add", name: "Inspection", after: "Qualified Lead" })
  --> Edge function executes: INSERT into pipeline_stages
  --> Result sent back to model
  --> Model responds: "Done! I've added 'Inspection' as a new pipeline stage, positioned after 'Qualified Lead'."
```

### Security Model
- Edge function validates JWT and checks user role via profiles table
- Config-writing tools require `master`, `owner`, or `office_admin` role
- Read-only/query tools available to `manager` and above
- All operations scoped to the user's `tenant_id`
- Tool executions logged to `ai_chat_messages.actions_taken` for audit trail

### Streaming Implementation
- Edge function proxies the SSE stream from Lovable AI Gateway
- Frontend parses SSE line-by-line and renders tokens as they arrive
- Tool calls interrupt the stream: the edge function detects `tool_calls` in the stream, executes them, then sends a follow-up request to get the final streamed response

### Existing Infrastructure Used
- `ai_chat_sessions` / `ai_chat_messages` tables for persistence
- `LOVABLE_API_KEY` secret for Lovable AI Gateway
- `lovable-ai.ts` shared helper patterns
- `supabase.ts` shared helpers for auth and service client
- Existing Settings tab system with role-based filtering
