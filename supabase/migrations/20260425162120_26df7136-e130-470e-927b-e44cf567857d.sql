UPDATE public.measurement_jobs
SET status = 'failed',
    progress_message = 'Timed out — please re-run AI measurement',
    error = 'Measurement job exceeded the 8 minute safety limit and was automatically stopped.',
    completed_at = now(),
    updated_at = now()
WHERE status IN ('queued', 'processing')
  AND created_at < now() - interval '8 minutes';