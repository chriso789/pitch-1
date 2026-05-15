
UPDATE public.srs_connections
SET
  customer_code = 'S046834',
  environment = 'staging',
  connection_status = 'disconnected',
  last_error = NULL,
  updated_at = now()
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';
