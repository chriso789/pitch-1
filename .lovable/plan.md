
# AI Admin Agent: Switch to OpenAI/Claude + Add Change Tracking

## Overview

Upgrade the AI Admin Command Center to use OpenAI (GPT-4o) and Anthropic (Claude) directly instead of the Lovable AI Gateway, and add project/change tracking so the agent logs every modification it makes, can reference past changes, and provides system update suggestions.

## What Changes

### 1. Edge Function: `supabase/functions/ai-admin-agent/index.ts` (rewrite)

**Switch AI provider:**
- Replace `ai.gateway.lovable.dev` calls with direct `api.openai.com/v1/chat/completions` using the existing `OPENAI_API_KEY` secret
- Use `gpt-4o` as the primary model for tool-calling (best tool-call support)
- Add fallback to Anthropic Claude via `api.anthropic.com/v1/messages` using the existing `ANTHROPIC_API_KEY` secret if OpenAI fails
- Remove all references to `LOVABLE_API_KEY`

**Add change tracking tools (new tools for the agent):**
- `log_change` -- Automatically called after every write operation to record what was changed, why, and by whom into a new `ai_admin_changes` table
- `list_recent_changes` -- Query past changes so the agent can reference its own history ("What did I change last week?")
- `suggest_system_updates` -- Analyze current config, pipeline health, and usage patterns to proactively suggest improvements
- `create_project` -- Create a tracked project/initiative (e.g., "Reorganize pipeline stages") stored in `ai_admin_projects` table
- `list_projects` -- View active projects and their status
- `update_project` -- Mark projects as in-progress, completed, or add notes

**Expand existing tools:**
- `query_table_schema` -- Let the agent inspect any table's columns and types (read-only, from `information_schema`)
- `run_read_query` -- Execute a read-only SELECT query against the database for flexible data analysis (parameterized, no writes)
- `list_edge_functions` -- Show deployed edge functions from config
- `list_rls_policies` -- Show RLS policies on a given table

### 2. New Database Tables (migration)

```sql
-- Track every change the AI agent makes
CREATE TABLE ai_admin_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  tool_name TEXT NOT NULL,
  tool_args JSONB NOT NULL DEFAULT '{}',
  result JSONB NOT NULL DEFAULT '{}',
  description TEXT,
  session_id UUID REFERENCES ai_chat_sessions(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track projects/initiatives the AI is working on
CREATE TABLE ai_admin_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',
  changes JSONB DEFAULT '[]',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: admin roles only, scoped to tenant
```

### 3. Frontend: `src/components/ai-admin/AIAdminChat.tsx` (update)

- Add a "Changes" sidebar/tab that shows recent `ai_admin_changes` entries
- Add a "Projects" sidebar/tab that shows `ai_admin_projects`
- Update suggested prompts to include new capabilities:
  - "What changes have been made recently?"
  - "Suggest system improvements"
  - "Create a project to reorganize our pipeline"
  - "Show me the schema of the contacts table"
  - "How many calls were made this month?"
- Add a model selector toggle (OpenAI / Claude) in the header so admin can choose which model to use

### 4. Config: `supabase/config.toml`

No changes needed -- `ai-admin-agent` is already registered.

## Architecture Flow

```text
User prompt --> AIAdminChat (frontend)
  --> POST /ai-admin-agent (edge function)
    --> Authenticate user, verify admin role
    --> Call OpenAI GPT-4o with tool definitions
    --> If tool_calls returned:
        --> Execute tools against DB (service-role)
        --> Log each tool execution to ai_admin_changes
        --> Send tool results back to OpenAI for final response
    --> Stream final response as SSE
    --> If OpenAI fails: retry with Anthropic Claude
  --> Frontend renders streamed markdown
  --> Frontend shows change log in sidebar
```

## Security

- Only `master`, `owner`, `corporate`, `office_admin` roles can access
- All write operations logged to `ai_admin_changes` with full audit trail
- `run_read_query` restricted to SELECT statements only (regex validated server-side)
- All operations scoped to user's `tenant_id`
- API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) stay server-side only

## Files Created
1. Migration SQL for `ai_admin_changes` and `ai_admin_projects` tables

## Files Modified
1. `supabase/functions/ai-admin-agent/index.ts` -- Rewrite to use OpenAI/Claude directly, add change tracking and expanded tools
2. `src/components/ai-admin/AIAdminChat.tsx` -- Add changes sidebar, projects tab, model selector, updated prompts
