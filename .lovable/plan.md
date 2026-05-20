## MSFH Campaign Engine — Phases 2–5 Build Plan

Phase 1 already shipped: `sms_templates` table, seeded MSFH templates, smart-tag resolver, template-pool + AI toggle UI in `TextBlastCreator`, live preview. We're extending the existing `sms_blasts` system (not creating a parallel `campaigns` schema) so O'Brien's live blast tool keeps working.

### Phase 2 — Send Engine
- **Edge function `generate-campaign-messages`**: pulls `sms_blast_items` for a blast, rotates across `template_pool_ids`, resolves smart tags per contact (loading contact + company + assigned_user), writes `personalized_message` per row. Adds "prior interaction" lookup → injects "We had spoken briefly in the past…" prefix when previous `sms_messages` exist for that contact.
- **Upgrade send worker**: stagger waves of 50 with 5–30s random delay; hard-block sends outside `send_window_start/end` in blast `timezone`; rotate `from_number` by contact area code (West FL=941, East FL=561); preserve existing "1/number/24h" cadence and STOP/HELP handling.
- **Lead filter UI** in `TextBlastCreator`: `last_contacted > N days`, `property_type`, `state`, `opted_out=false`. Saves filter into blast and resolves audience at queue time.

### Phase 3 — Inbound + AI Follow-up
- **`classify-sms-intent` edge function** (Lovable AI, `google/gemini-3-flash-preview`): returns `positive_interest | not_interested | stop | already_applied | call_me | inspection_question | roof_issue | financing_question`.
- **`ai-followup-worker` edge function**: consultative MSFH system prompt, only fires when `ai_followup_enabled=true` and intent is conversational. Replies via existing `telnyx-send-sms`, marks message `ai_generated=true`. STOP/opt-out always wins.
- Hook both into existing `sms-inbound-webhook`. All messages continue landing in the unified inbox + contact timeline.

### Phase 4 — Automation + Pipeline
- Seed MSFH pipeline stages: `MSFH Contacted → Interested → Inspection Scheduled → Inspection Complete → Grant Submitted → Approved → Roof Closed`.
- New automation event `SMS_POSITIVE_REPLY` wired into `automation-processor`. On positive intent: create pipeline entry at "MSFH Interested", spawn 4 tasks (Call within 15 min / Check wind mitigation / Verify roof age / Schedule inspection), notify assigned rep.

### Phase 5 — Analytics
- Analytics card on `TextBlastDetail`: Delivered %, Response %, Positive Response %, Opt-out %, Appointments Booked, Grant Interest Rate, Conversions to MSFH pipeline. Queries existing `sms_blast_items` + new intent column.

### Technical notes
- All new tables/columns RLS-scoped via `tenant_id`. No `service_role_key` on client.
- Edge functions: `npm:` specifiers, explicit `Deno.serve(handler)`, CORS, JWT validation in-code.
- Cost guard: AI follow-up uses `gemini-3-flash-preview` (cheap), intent classifier uses `gemini-2.5-flash-lite`.

### Recommendation
This is ~8 hours of careful work across migrations + 3 edge functions + UI. **Approve Phase 2 first** so we can validate generation + sending against a small live audience before wiring AI replies and pipeline automation on top. Reply "go phase 2" (or "go all phases") and I'll start.
