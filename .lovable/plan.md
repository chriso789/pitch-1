

## Plan: AI Answering Service for Unanswered Main Line Calls

### What We're Building

A production-ready AI answering service that intercepts unanswered inbound calls to any company's main line number. When enabled, the AI agent will:
- Greet callers with a company-branded message
- Qualify leads conversationally (name, address, service needed, roof age, insurance, timeline)
- Create contacts and pipeline entries (leads) directly in the CRM
- Schedule appointments by inserting into the appointments table
- Score leads and notify reps of hot leads via SMS
- Support human escalation at any time

### What Already Exists

The codebase has significant infrastructure already built:
- `telnyx-ai-answering` — basic gather-only agent (collects info, creates contact + task, hangs up)
- `telnyx-ai-agent-enhanced` — richer qualification with lead scoring, but still only creates contacts and tasks (no pipeline entry / lead creation, no appointment booking)
- `call-forwarding` — routes calls and falls back to answering service when no one picks up
- `ai_answering_config` table — per-tenant config (greeting, voice, model, business hours, qualification questions)
- `AIAgentSettingsPage` — full settings UI for enabling/configuring the AI agent
- `create-lead-with-contact` — the canonical lead creation function

### The Gap

The current `telnyx-ai-agent-enhanced` function does NOT:
1. Create pipeline entries (leads) — it only creates contacts and tasks
2. Book appointments — no appointment creation logic
3. Use the Lovable AI Gateway — it calls OpenAI directly (hardcoded)
4. Integrate with the `create-lead-with-contact` pattern for proper lead source tracking and dedup
5. Send SMS notifications to reps about new AI-qualified leads
6. Handle multi-turn conversation for appointment scheduling (date/time selection)

### Implementation

#### 1. Rewrite `telnyx-ai-agent-enhanced` Edge Function

Replace the current implementation with a complete answering service agent:

**Call flow:**
1. `call.initiated` (incoming) → Answer the call with `client_state` containing tenant info
2. `call.answered` → Load tenant's `ai_answering_config`, start `gather_using_ai` with an enhanced system prompt that instructs the AI to qualify AND offer to schedule an appointment
3. `gather_using_ai.ended` → Process results:
   - Find or create contact (dedup by phone number, then by name+address)
   - Create pipeline entry with `status: 'lead'`, proper `source` mapping, and `metadata.created_via: 'ai-answering-service'`
   - If caller wants an appointment, create an `appointments` record with the gathered date/time
   - Calculate lead score based on responses (timeline urgency, insurance, storm damage, roof age)
   - Log to `communication_history` and `ai_call_transcripts`
   - Send SMS notification to assigned rep or location manager via `messaging-send-sms`
   - If lead score >= 80, also invoke `trigger-sales-notification`
4. `transfer` tool used → Transfer to on-call number from tenant settings
5. `call.hangup` → Log completion

**Key changes from current version:**
- Use Lovable AI Gateway instead of direct OpenAI calls (for the system prompt / gather config only — Telnyx `gather_using_ai` handles the actual voice AI)
- Add pipeline entry creation using service role client (mirrors `create-lead-with-contact` logic)
- Add appointment insertion into the `appointments` table
- Add SMS notification to rep via `messaging-send-sms` edge function invocation
- Enhanced `system_prompt` for the Telnyx gather that instructs the AI to offer appointment scheduling and collect preferred date/time

**Gather parameters addition:**
```
preferred_appointment_date: { description: 'Preferred date for inspection/estimate', type: 'string' }
preferred_appointment_time: { description: 'Preferred time of day (morning, afternoon, evening)', type: 'string' }
wants_appointment: { description: 'Whether the caller wants to schedule an appointment', type: 'boolean' }
```

#### 2. Add Appointment Creation Logic

After gathering results, if `wants_appointment` is true and date/time are provided:
- Insert into `appointments` table with `type: 'inspection'`, the contact_id, and tenant_id
- Set status to `'scheduled'` 
- Assign to the location manager or round-robin rep

#### 3. Add Pipeline Entry (Lead) Creation

After contact creation/lookup, create a proper lead:
- Insert into `pipeline_entries` with `status: 'lead'`, `source: 'other'` (mapped from 'Call In'), `lead_name`, `assigned_to`
- Include metadata: `{ created_via: 'ai-answering-service', ai_lead_score, gathered_data }`
- Set `location_id` from the resolved location

#### 4. Add Rep SMS Notification

After lead creation, send SMS to the assigned rep or location manager:
- Invoke `messaging-send-sms` with a formatted message containing caller name, service needed, lead score, and appointment time if scheduled
- For hot leads (score >= 80), also fire real-time notification

#### 5. Update Settings UI — Minor Enhancement

Add a toggle in `AIAgentSettingsPage` for:
- "Auto-create leads from AI calls" (default: on)
- "Auto-schedule appointments" (default: on)
- "SMS notify rep on new AI lead" (default: on)

These will be stored as new fields in `ai_answering_config`.

### Database Changes

**Migration: Add columns to `ai_answering_config`**
```sql
ALTER TABLE ai_answering_config
ADD COLUMN IF NOT EXISTS auto_create_leads boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS auto_schedule_appointments boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS sms_notify_rep boolean DEFAULT true;
```

### Files to Change

1. `supabase/functions/telnyx-ai-agent-enhanced/index.ts` — Full rewrite with lead creation, appointment booking, SMS notification
2. `supabase/migrations/[new].sql` — Add config columns
3. `src/pages/settings/AIAgentSettingsPage.tsx` — Add toggles for new features
4. `src/integrations/supabase/types.ts` — Auto-updated after migration

### Expected Result for O'Brien Contracting

When a potential client calls O'Brien's main number and nobody answers:
1. AI picks up with O'Brien's custom greeting
2. Conversationally collects: name, phone, address, service needed, roof age, insurance status, timeline
3. Offers to schedule an inspection appointment
4. Creates a contact in the CRM (or finds existing)
5. Creates a lead in the pipeline with proper scoring
6. Books the appointment if requested
7. Sends SMS to the assigned rep: "New AI Lead: John Smith - Storm damage repair. Score: 85. Appointment: Tomorrow 2pm. Call back: (555) 123-4567"
8. Rep sees the lead on their pipeline board immediately

