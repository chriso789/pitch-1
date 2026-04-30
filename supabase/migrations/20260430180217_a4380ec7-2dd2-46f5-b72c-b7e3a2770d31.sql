update public.measurement_jobs mj
set
  status = case when aj.status = 'failed' then 'failed' else 'completed' end,
  progress_message = coalesce(aj.status_message, mj.progress_message, 'Measurement finished'),
  error = case when aj.status = 'failed' then coalesce(aj.failure_reason, aj.status_message, 'AI measurement failed') else null end,
  measurement_id = coalesce(mj.measurement_id, aj.legacy_roof_measurement_id),
  completed_at = coalesce(mj.completed_at, aj.completed_at, now()),
  updated_at = now()
from public.ai_measurement_jobs aj
where mj.ai_measurement_job_id = aj.id
  and mj.status in ('queued', 'processing')
  and aj.status in ('completed', 'needs_review', 'needs_manual_measurement', 'failed')
  and mj.created_at < now() - interval '2 minutes';