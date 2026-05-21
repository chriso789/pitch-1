# SMS Blast Launch — Manual Test Plan
Campaign: **Roof Estimate Email Capture — MSFH**
Goal: `collect_homeowner_email_for_roof_estimate`

## Setup
1. Create 5 test contacts in the active tenant:
   - 3 with full address + phone
   - 1 with phone but no `address_street`
   - 1 opted out (insert into `opt_outs` with channel `sms`)

## Dry-run
2. Open Text Blasts → New → name the campaign.
3. Pick Contact List mode, choose the status holding these 5 contacts, set batch size to **5**.
4. Select Campaign Goal: **Roof Estimate Email Capture — MSFH**.
5. Enable **AI Follow-up Agent**.
6. Pick at least 2 templates for the rotation pool.
7. Check **Dry run** → click **Dry-run render for 5**.

## Verify dry-run results
8. Confirm `sms_blast_items` counts: **3 rendered**, **1 skipped_missing_address**, **1 skipped_opt_out** (or opted_out).
9. Locked preview shows each rendered row with the correct `address_street_snapshot`.
10. `SmsBlastLaunchChecklist` shows all required items green.
11. Try to live-send WITHOUT a dry-run on a fresh draft → toast says “Run a dry-run first…”. Launch button on the checklist is disabled until ready.

## Live send
12. Click **Launch Campaign** from the checklist.
13. Confirm only **3** messages send (`sms_blast_items.status = sent`). Missing-address and opted-out rows untouched.
14. Reply from a test phone with an email address.
15. Verify:
    - `sms_messages` inbound row created with `blast_id`
    - contact email updated OR `sms_messages.metadata.captured_email` populated
    - matching `sms_blast_item.status = replied`
    - `pipeline_entries.status = roof_estimate_email_captured` exists
    - rep task created
    - AI follow-up does NOT auto-reply once a human takes over the thread
