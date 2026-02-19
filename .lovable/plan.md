

# Fix AI Admin Assistant -- Session Error + Master-Only Access

## Problem Identified

The "Failed to create chat session" error is caused by a **database CHECK constraint** on the `ai_chat_sessions` table. The constraint only allows these session types:

- `general`, `lead_assist`, `task_planning`, `pipeline_review`

But the AI Admin Chat tries to insert `session_type: 'admin'`, which the database rejects.

## Changes Required

### 1. Database: Add 'admin' to the session_type CHECK constraint

Run a migration to drop the old constraint and add a new one that includes `'admin'`:

```sql
ALTER TABLE ai_chat_sessions DROP CONSTRAINT ai_chat_sessions_session_type_check;
ALTER TABLE ai_chat_sessions ADD CONSTRAINT ai_chat_sessions_session_type_check 
  CHECK (session_type = ANY (ARRAY['general', 'lead_assist', 'task_planning', 'pipeline_review', 'admin']));
```

This is the root cause of the "Failed to create chat session" error.

### 2. Restrict AI Admin tab to Master role only

Update the `settings_tabs` row for `ai-admin` so only the `master` role can see it:

```sql
UPDATE settings_tabs 
SET required_role = ARRAY['master'] 
WHERE tab_key = 'ai-admin';
```

Currently it is visible to `master`, `owner`, `corporate`, and `office_admin`. Per the user's request, only the Master Developer login should see this tab.

### 3. No edge function or frontend code changes needed

- The `ai-admin-agent` edge function already has full tool-calling with 20+ tools for reading and writing CRM configuration (pipeline stages, lead sources, contact statuses, app settings, projects, etc.)
- It already uses OpenAI with streaming + Anthropic fallback
- The `AIAdminChat` component already handles streaming, image uploads, and change tracking
- Once the DB constraint is fixed, everything will work end-to-end

## Summary

This is a two-line database fix:
1. Add `'admin'` to the allowed session types (fixes the error)
2. Restrict the tab to `master` role only (per user requirement)

