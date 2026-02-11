

## AI Agent Settings Enhancement: Configurable Qualification Questions + Test Call

### What This Does

Adds two key features to your existing AI Agent Settings page (`/settings/ai-agent`):

1. **Qualification Questions tab** -- Configure which questions the AI asks callers (currently hardcoded as name, phone, service, roof age, insurance claim, timeline, budget)
2. **Test Call button** -- Trigger a test call from the UI to verify the full flow works end-to-end

---

### Changes Overview

| Area | What Changes |
|------|-------------|
| Settings UI | Add "Qualification" tab with drag-to-reorder question builder |
| Settings UI | Add "Test Call" section with phone number input + call button |
| Database | Add `qualification_questions` JSONB column to `ai_answering_config` |
| Edge Function | Update `telnyx-ai-answering` to read questions from config instead of hardcoded |
| Edge Function | Create `test-ai-call` function to initiate an outbound test call |

---

### 1. Database: Add qualification_questions column

Add a `qualification_questions` JSONB column to `ai_answering_config` that stores an array of configurable questions:

```sql
ALTER TABLE ai_answering_config 
ADD COLUMN IF NOT EXISTS qualification_questions JSONB DEFAULT '[
  {"key": "name", "label": "Caller Name", "description": "Full name of the caller", "type": "string", "required": true, "enabled": true},
  {"key": "service_needed", "label": "Service Needed", "description": "What service they need", "type": "string", "required": true, "enabled": true},
  {"key": "callback_number", "label": "Callback Number", "description": "Best phone number to reach them", "type": "string", "required": true, "enabled": true},
  {"key": "address", "label": "Property Address", "description": "Property address where service is needed", "type": "string", "required": false, "enabled": true},
  {"key": "roof_age", "label": "Roof Age", "description": "Approximate age of the roof", "type": "string", "required": false, "enabled": false},
  {"key": "has_insurance_claim", "label": "Insurance Claim", "description": "Whether they have an insurance claim", "type": "boolean", "required": false, "enabled": false},
  {"key": "timeline", "label": "Timeline", "description": "When they want the work done", "type": "string", "required": false, "enabled": false},
  {"key": "budget_range", "label": "Budget Range", "description": "Approximate budget if mentioned", "type": "string", "required": false, "enabled": false}
]';
```

### 2. Settings UI: Qualification Questions Tab

Add a new "Qualification" tab to the existing settings page with:

- List of qualification questions with toggle switches (enable/disable)
- Each question shows: label, description, required checkbox
- "Add Custom Question" form at the bottom (key, label, description, type, required)
- Delete button for custom questions (built-in ones can only be toggled)

### 3. Settings UI: Test Call Section

Add a card at the top of the settings page (below the enable toggle) with:

- Phone number input field
- "Make Test Call" button that calls the `test-ai-call` edge function
- Status indicator showing call progress (initiating, ringing, answered, completed)
- Note explaining this will call the entered number and run the AI agent

### 4. Edge Function: Update telnyx-ai-answering

Modify the `gather_using_ai` parameters section to dynamically build the `properties` and `required` arrays from the `qualification_questions` config instead of hardcoded values:

```typescript
// Instead of hardcoded properties...
// Build from config
const questions = tenantConfig.qualification_questions || defaultQuestions;
const properties: Record<string, any> = {};
const required: string[] = [];

for (const q of questions) {
  if (!q.enabled) continue;
  properties[q.key] = { description: q.description, type: q.type };
  if (q.required) required.push(q.key);
}
```

### 5. Edge Function: test-ai-call

New edge function that initiates an outbound call to a test number using the tenant's Telnyx number, then triggers the same AI gather flow. This lets you verify the greeting, voice, and questions without needing an external caller.

---

### Technical Details

**Files to create:**
- `supabase/functions/test-ai-call/index.ts` -- Initiates outbound test call via Telnyx API

**Files to modify:**
- `src/pages/settings/AIAgentSettingsPage.tsx` -- Add Qualification tab + Test Call section
- `supabase/functions/telnyx-ai-answering/index.ts` -- Read qualification_questions from config
- `supabase/config.toml` -- Add test-ai-call function entry

**Database migration:**
- Add `qualification_questions` JSONB column to `ai_answering_config`

