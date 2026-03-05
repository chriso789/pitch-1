INSERT INTO pipeline_entries (tenant_id, contact_id, status, source, created_at, updated_at, is_deleted, metadata)
VALUES (
  '14de934e-7964-4afd-940a-620d2ace125d',
  'c4d13a17-ec31-4488-9e79-6e373804ed95',
  'project',
  'canvassing',
  now(),
  now(),
  false,
  '{"auto_created": true, "reason": "backfill_for_production_job", "job_id": "cd5abd1e-af22-447f-a147-51b41ccc467e"}'::jsonb
)