-- Cron: dispatcher
SELECT cron.schedule(
  'automation-dispatcher-every-minute',
  '* * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/automation-dispatcher',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM"}'::jsonb,
    body := '{}'::jsonb
  );
  $cmd$
);

-- Cron: worker
SELECT cron.schedule(
  'automation-worker-every-minute',
  '* * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/automation-worker',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM"}'::jsonb,
    body := '{}'::jsonb
  );
  $cmd$
);

-- Cron: ai context builder (every 2 minutes)
SELECT cron.schedule(
  'ai-context-builder-every-2-minutes',
  '*/2 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/ai-context-builder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM"}'::jsonb,
    body := '{}'::jsonb
  );
  $cmd$
);

-- Realtime kick on new domain_events
CREATE OR REPLACE FUNCTION public.tg_domain_events_kick_dispatcher()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/automation-dispatcher',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM"}'::jsonb,
    body := jsonb_build_object('event_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[domain_events kick] failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS domain_events_kick_dispatcher ON public.domain_events;
CREATE TRIGGER domain_events_kick_dispatcher
AFTER INSERT ON public.domain_events
FOR EACH ROW EXECUTE FUNCTION public.tg_domain_events_kick_dispatcher();