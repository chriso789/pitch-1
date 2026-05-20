-- Ensure required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior schedule with this name so this migration is idempotent
DO $$
BEGIN
  PERFORM cron.unschedule('srs-order-status-poller-every-2min');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'srs-order-status-poller-every-2min',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/srs-order-status-poller',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM"}'::jsonb,
    body := concat('{"cron_at":"', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- Backfill: reset the dropped order so the team can resubmit it.
-- SRS returned 404 for both transactionID and orderID; the queue entry was dropped.
UPDATE public.srs_orders
SET status = 'draft',
    srs_order_id = NULL,
    srs_transaction_id = NULL,
    submitted_at = NULL
WHERE id = 'd80aeb55-1167-465f-b7e4-1ff43844e13d';

INSERT INTO public.srs_order_status_history (order_id, old_status, new_status, status_message)
VALUES (
  'd80aeb55-1167-465f-b7e4-1ff43844e13d',
  'submitted',
  'draft',
  'SRS returned 404 on both transactionID 7c47b2b8-2a0c-4d79-9130-ea346ef7312e and orderID 2af3bc3c-eb3f-46a6-a13a-665f85048943. The original submit only reached SRS''s intake queue (queueID=orderID, message "Order Queued") and was silently dropped. Reset to draft for resubmission.'
);