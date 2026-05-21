## Scope

Add the **Roof Estimate Email Capture — MSFH** campaign on top of the existing `sms_blasts` / `sms_blast_items` / `ai-followup-worker` system. Do not fork the texting stack.

## What's already enforced (no changes needed)

- Per-item `personalized_message` is rendered once, stored on `sms_blast_items`, and `sms-blast-processor` sends that exact stored body (`personalizedMap.get(item.id)`). Address can't bleed across contacts.
- Opt-out check pre-claim and per-item.
- Send-window + circuit breaker + area-code from-number routing.
- AI follow-up worker already classifies intent, refuses on human takeover/opt-out, sends through `telnyx-send-sms`, and creates MSFH pipeline entries + 4 tasks.
- Inbound webhook already attaches replies to the correct lead (last work).

## 1. Seed templates (per tenant)

Insert two `sms_templates` rows for every tenant, both with `goal = 'collect_homeowner_email_for_roof_estimate'`, `category = 'msfh_email_capture'`:

- **Roof Estimate Email Capture — MSFH** (primary)
- **Roof Estimate Email Capture — MSFH (Short)** (rotating variant)

Use existing `{{contact.first_name}}`, `{{contact.address1}}`, `{{contact.city}}` smart tags (resolver already maps these to `contacts.address_street` / `address_city`).

## 2. Seed pipeline stage (per tenant)

Insert `pipeline_stages` row keyed `roof_estimate_email_captured` (idempotent — skip if exists). Color/order placed after `msfh_interested`.

## 3. Tighten `generate-campaign-messages`

When `blast.goal === 'collect_homeowner_email_for_roof_estimate'`:
- If contact is missing `address_street`, mark the `sms_blast_items` row `status='failed'`, `last_error='skipped_missing_address'` instead of producing a stripped message. Guarantees no address-less email-capture send.
- Surface a count of skipped-missing-address rows in the response.

## 4. Add email-capture branch to `ai-followup-worker`

Before intent classification, regex-extract an email from the inbound body. If found AND the originating blast goal is `collect_homeowner_email_for_roof_estimate`:
- Update `contacts.email` if empty; otherwise append `{ secondary_emails: [...] }` into `contacts.metadata`.
- Upsert a `pipeline_entries` row with `status='roof_estimate_email_captured'`, source `sms_campaign`.
- Spawn one task: "Send roof replacement estimate and MSFH info" — due in 15 min, priority `urgent`, assigned to `blast.created_by`.
- Reply with the captured-email follow-up message ("Perfect, I'll get the estimate for {address} sent over…") via `telnyx-send-sms`.
- Skip the normal MSFH intent / hot-pipeline branch for this turn.

## 5. UI — `TextBlastCreator`

Minimal additions to the existing preview pane:
- Show count of recipients skipped for `missing_address` and `opted_out` in the launch confirmation.
- Show 3 sample rendered messages (already present — verify it's rendering personalized_message vs raw script).
- Dry-run toggle: passes `{ dry_run: true }` to `generate-campaign-messages` so messages are rendered and stored, but `sms-blast-processor` is NOT kicked. (Implemented by leaving blast in `draft` and not calling the processor.)

## 6. Out of scope (will NOT do)

- New SMS sending pipeline, new contact table, new Telnyx wiring.
- Touching `telnyx-send-sms` or `telnyx-inbound-webhook` behavior.
- Replacing the existing template pool / rotation logic.

## Technical files

- Migration: seed templates per tenant (loop), seed pipeline stage, idempotent.
- `supabase/functions/generate-campaign-messages/index.ts` — add goal-aware address-required gate + skip counts.
- `supabase/functions/ai-followup-worker/index.ts` — add email-capture branch ahead of classifier.
- `src/components/communications/TextBlastCreator.tsx` — preview counts + dry-run toggle.

Reply "go" and I'll ship it. Reply with edits if you want to change scope (e.g. skip the dry-run toggle, or change the rotating variant copy).