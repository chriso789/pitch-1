update public.ai_measurement_jobs
set status = 'failed',
    hard_fail_reason = 'ai_measurement_runtime_timeout',
    failure_reason = 'ai_measurement_runtime_timeout',
    report_blocked = true,
    needs_review = true,
    completed_at = now(),
    updated_at = now(),
    status_message = 'cleanup: manual fail after stuck >120s; superseded by hardened timeout deploy 09e2df7'
where id = '6d93693d-9ade-4f20-ab32-9768ffcb9ce8'
  and status in ('running','processing','queued','pending');