
-- Make sure pg_cron and pg_net are available
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule prior versions if they exist (idempotent re-deploy)
DO $$
DECLARE j RECORD;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('srs-catalog-refresh-weekly', 'srs-reconciliation-daily')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- Weekly catalog refresh: Sundays 03:00 UTC
SELECT cron.schedule(
  'srs-catalog-refresh-weekly',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/srs-price-refresh-scheduler',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM","x-sync-type":"scheduled-weekly"}'::jsonb,
    body := '{"vendor_code":"SRS","batch_size":50}'::jsonb
  );
  $$
);

-- Daily reconciliation: every day at 02:30 UTC
SELECT cron.schedule(
  'srs-reconciliation-daily',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/srs-reconciliation-report',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM"}'::jsonb,
    body := '{"run_type":"scheduled","stale_hours":24}'::jsonb
  );
  $$
);
