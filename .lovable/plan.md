
# My Safe Florida Home (MSFH) Campaign Engine

This is a large, multi-system build. Pitch already has a TextBlast system (`sms_blasts`, `sms_blast_items`, `TextBlastCreator`, `TextBlastDetail`, `telnyx-send-sms`, `sms-inbound-webhook`), a contacts/leads pipeline, automations, and Telnyx wiring. Rather than create a parallel `campaigns` schema that duplicates what we already have, I'll **extend the existing blast system** to cover the MSFH spec, and add the new pieces (templates, smart tags, AI follow-up, MSFH pipeline stage, analytics) on top.

## Phased Build (recommend approving phases independently)

### Phase 1 — Foundation (DB + Templates + Smart Tags)
- New table `sms_templates` (tenant-scoped, category, rotation pool, active flag) seeded with the MSFH default + 3 rotation variants.
- Extend `sms_blasts` with: `template_pool_ids uuid[]`, `ai_followup_enabled bool`, `send_window_start time`, `send_window_end time`, `timezone text`, `goal text` (e.g. `msfh_grant`).
- Smart tag resolver `src/lib/smartTags/smsTagResolver.ts` supporting `{{contact.first_name}}`, `address1/city/state/zip`, `{{company.name/phone}}`, `{{assigned_user.first_name}}`, with fallbacks ("there", "your property").
- Live message preview in `TextBlastCreator` rendered against a real contact sample.

### Phase 2 — Send Engine Upgrades
- New edge function `generate-campaign-messages`: pulls contacts via existing blast list, rotates across `template_pool_ids`, resolves smart tags, writes personalized message to `sms_blast_items.personalized_message`.
- Upgrade existing send worker to:
  - Stagger in waves of 50 with random 5–30s delays.
  - Enforce `send_window_start/end` per tenant timezone (quiet hours, hard block).
  - Honor existing "1 per number per 24h" cadence already implemented.
  - Rotate `from_number` based on contact location (West=941, East=561) — already partially wired.
- STOP/HELP keyword handling confirmed in `sms-inbound-webhook` (add MSFH-specific keywords if missing).

### Phase 3 — Inbound + AI Follow-up
- Extend `sms-inbound-webhook` to call new `classify-sms-intent` edge function returning one of: `positive_interest | not_interested | stop | already_applied | call_me | inspection_question | roof_issue | financing_question`.
- New edge function `ai-followup-worker` using Lovable AI Gateway (google/gemini-3-flash) with the consultative MSFH system prompt. Triggered only when `ai_followup_enabled` and intent is conversational. Writes AI reply with `ai_generated=true`.
- All inbound/outbound messages continue to land in the existing unified inbox + contact timeline (already wired via `sms_messages` triggers — confirm and patch if needed).

### Phase 4 — Automation + Pipeline
- Seed `pipeline_stages` with MSFH-specific stages: `MSFH Contacted → Interested → Inspection Scheduled → Inspection Complete → Grant Submitted → Approved → Roof Closed`.
- On `positive_interest` intent: trigger automation that creates a pipeline entry at "MSFH Interested", spawns 4 tasks (Call within 15 min, Check wind mitigation, Verify roof age, Schedule inspection), and notifies the assigned rep. Uses existing `automation-processor` event bus (`SMS_POSITIVE_REPLY` new event).

### Phase 5 — Campaign Builder UI + Analytics
- New `MSFHCampaignBuilder` component (or extend `TextBlastCreator` with a "Campaign Goal" preset that loads MSFH template + filters).
- Lead filter UI: `last_contacted > 7 days`, `property_type = single_family`, `state = FL`, `opted_out = false`.
- Analytics card on `TextBlastDetail`: Delivered %, Response %, Positive Response %, Opt-out %, Appointments Booked, Grant Interest Rate, Conversions to MSFH pipeline.

## Technical Notes
- Reuses existing tables/functions where possible — no duplicate `campaigns` table; `sms_blasts` IS the campaigns table with added columns.
- All new tables RLS-scoped by `tenant_id` via `useEffectiveTenantId()`.
- Edge functions follow project standards (`npm:` specifiers, explicit `Deno.serve(handler)`, CORS).
- AI calls via Lovable AI Gateway (`LOVABLE_API_KEY` already provisioned).
- New events added to `AUTOMATION_EVENTS`: `SMS_POSITIVE_REPLY`, `SMS_OPT_OUT`, `MSFH_INSPECTION_REQUESTED`.

## Recommendation
This is roughly 8–12 hours of careful work. **I suggest we approve Phase 1 first** (templates + smart tags + preview), validate the MSFH messaging renders correctly against a real Florida contact, then move through phases 2–5 one at a time. Trying to ship all phases in one shot risks breaking the existing TextBlast system that O'Brien is already using.

Want me to start with Phase 1, or batch Phases 1–2 together?
