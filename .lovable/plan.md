## Problem

The `TEST 2` blast (`bb0ed3d3-…`) is stuck at 0% because the `sms-blast-processor` cron is hitting the quiet-hours gate (`isWithinSendWindow`) every minute and skipping. The blast's window is 09:00–20:00 America/New_York, and it's currently ~9:30 PM ET.

Confirmed by:
- 1 `sms_blast_items` row, `status='pending'`, no error
- Processor edge logs show steady minute-by-minute boots with no claim activity
- `last_processor_run_at` is updating every minute (gate path), but no items move

## Fix

One-row update on `sms_blasts` for this blast only:

```sql
update sms_blasts
set send_window_start = '00:00:00',
    send_window_end   = '23:59:00'
where id = 'bb0ed3d3-8d0c-466e-a43f-7081f36e1419';
```

No code or schema changes. No other blasts affected. The next cron tick (within 60s) will claim the 1 pending recipient and send via `telnyx-send-sms`. Status should flip `sending → completed` and the recipient pill `pending → sent`.

## What I'm NOT changing

- No new "Send now / override quiet hours" UI button
- No banner change in the launch checklist
- No global default for send windows
- No edge function deploys

If you also want the "outside send window" reason surfaced in the UI so this isn't confusing next time, say the word and I'll add it as a follow-up.