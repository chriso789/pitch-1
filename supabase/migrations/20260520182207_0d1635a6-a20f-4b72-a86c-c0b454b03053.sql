
SELECT cron.schedule(
  'prune-log-tables-nightly',
  '0 3 * * *',
  $$SELECT public.prune_log_tables();$$
);
