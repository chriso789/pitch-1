-- Switch SRS price refresh from weekly to bi-weekly (1st & 15th of each month)
-- and add supplier-isolated bi-weekly jobs for ABC and QXO. Each job hits
-- the SAME scheduler function but with a different vendor_code, which keeps
-- price_history and price_cache writes strictly isolated per supplier.

DO $$
DECLARE
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM';
BEGIN
  -- Drop the old weekly SRS job (being replaced with bi-weekly)
  PERFORM cron.unschedule('srs-catalog-refresh-weekly')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='srs-catalog-refresh-weekly');

  -- Drop any prior bi-weekly versions so this migration is idempotent
  PERFORM cron.unschedule(j) FROM (
    VALUES
      ('srs-catalog-refresh-biweekly'),
      ('abc-catalog-refresh-biweekly'),
      ('qxo-catalog-refresh-biweekly'),
      ('srs-reconciliation-daily')
  ) AS t(j)
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = t.j);

  -- SRS: bi-weekly @ 03:00 UTC on the 1st & 15th
  PERFORM cron.schedule(
    'srs-catalog-refresh-biweekly',
    '0 3 1,15 * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/srs-price-refresh-scheduler',
        headers := %L::jsonb,
        body := '{"vendor_code":"SRS","batch_size":50}'::jsonb
      );
    $cron$,
    jsonb_build_object(
      'Content-Type','application/json',
      'apikey', anon_key,
      'x-sync-type','scheduled-biweekly'
    )::text)
  );

  -- ABC: bi-weekly @ 04:00 UTC on the 1st & 15th (kept supplier-isolated)
  PERFORM cron.schedule(
    'abc-catalog-refresh-biweekly',
    '0 4 1,15 * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/srs-price-refresh-scheduler',
        headers := %L::jsonb,
        body := '{"vendor_code":"ABC","batch_size":50}'::jsonb
      );
    $cron$,
    jsonb_build_object(
      'Content-Type','application/json',
      'apikey', anon_key,
      'x-sync-type','scheduled-biweekly'
    )::text)
  );

  -- QXO: bi-weekly @ 05:00 UTC on the 1st & 15th (kept supplier-isolated)
  PERFORM cron.schedule(
    'qxo-catalog-refresh-biweekly',
    '0 5 1,15 * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/srs-price-refresh-scheduler',
        headers := %L::jsonb,
        body := '{"vendor_code":"QXO","batch_size":50}'::jsonb
      );
    $cron$,
    jsonb_build_object(
      'Content-Type','application/json',
      'apikey', anon_key,
      'x-sync-type','scheduled-biweekly'
    )::text)
  );

  -- Daily reconciliation now folded into the poller (mode=reconcile)
  PERFORM cron.schedule(
    'srs-reconciliation-daily',
    '30 2 * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/srs-order-status-poller',
        headers := %L::jsonb,
        body := '{"mode":"reconcile","run_type":"scheduled","stale_hours":24}'::jsonb
      );
    $cron$,
    jsonb_build_object(
      'Content-Type','application/json',
      'apikey', anon_key
    )::text)
  );
END $$;